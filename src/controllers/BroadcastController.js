const { MessageEmbed, MessageActionRow, MessageButton, MessageSelectMenu } = require('discord.js');
const config = require('../../config');
const broadcastManager = require('../models/BroadcastManager');
const languageManager = require('../models/LanguageManager');
const { createLogger } = require('../utils/helpers');

const logger = createLogger('BroadcastController');
const MAX_BROADCAST_LENGTH = 2000;
const MAX_PREVIEW_LENGTH = 200;

class BroadcastController {
    constructor() {
        this.broadcasts = new Map();
        this.sessions = new Map();
    }

    async handleCommand(message) {
        try {
            if (message.guild.id !== config.server.guildId) {
                return message.reply({
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.error)
                            .setDescription(languageManager.translate('messages.permissionDenied'))
                    ]
                });
            }

            const hasPermission = message.member.roles.cache.has(config.server.broadcastRoleId);
            if (!hasPermission) {
                return message.reply({
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.error)
                            .setTitle(languageManager.translate('embeds.errors.permissionDenied'))
                            .setDescription(languageManager.translate('messages.permissionDenied'))
                    ]
                });
            }

            const broadcastMessage = message.content.slice(4).trim();
            
            if (!broadcastMessage) {
                return message.reply({
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.error)
                            .setDescription(languageManager.translate('messages.emptyMessage'))
                    ]
                });
            }
            
            if (broadcastMessage.length > MAX_BROADCAST_LENGTH) {
                return message.reply({
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.error)
                            .setTitle(languageManager.translate('embeds.errors.messageTooLong'))
                            .setDescription(languageManager.translate('messages.messageTooLong', 
                                MAX_BROADCAST_LENGTH, 
                                broadcastMessage.length))
                    ]
                });
            }

            this.broadcasts.set(message.author.id, broadcastMessage);

            const embed = new MessageEmbed()
                .setColor(config.colors.primary)
                .setTitle(languageManager.translate('embeds.broadcast.title'))
                .setDescription(languageManager.translate('embeds.broadcast.description'))
                .addField(
                    languageManager.translate('embeds.broadcast.messageContent'),
                    `\`\`\`${broadcastMessage.length > MAX_PREVIEW_LENGTH ? 
                        broadcastMessage.slice(0, MAX_PREVIEW_LENGTH) + '...' : 
                        broadcastMessage}\`\`\``
                )
                .addField(
                    languageManager.translate('embeds.broadcast.messageInfo'),
                    `• ${languageManager.translate('embeds.broadcast.messageLength')}: ${broadcastMessage.length}/${MAX_BROADCAST_LENGTH}`
                );

            const reply = await message.reply({
                embeds: [embed],
                components: this.createTargetButtons()
            });
            
            this.sessions.set(message.author.id, {
                message: reply,
                authorId: message.author.id,
                guildId: message.guild.id
            });
            
            logger.info(`Broadcast command initiated by ${message.author.tag}`);
        } catch (error) {
            logger.error(`Error handling broadcast command: ${error.message}`, error);
            message.reply(languageManager.translate('messages.targetSelectionError'));
        }
    }

    async handleLanguageCommand(message) {
        try {
            if (message.guild.id !== config.server.guildId) {
                return message.reply({
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.error)
                            .setDescription(languageManager.translate('messages.invalidGuild'))
                    ]
                });
            }

            const langs = languageManager.getAllLanguages();
            const langOptions = Object.values(langs).map(lang => {
                return `${lang.language.code}: ${lang.language.native}`;
            }).join('\n');
            
            const embed = new MessageEmbed()
                .setColor(config.colors.primary)
                .setTitle(languageManager.translate('system.languageSelection'))
                .setDescription(languageManager.translate('system.selectLanguage') + '\n\n' + langOptions);
            
            await message.reply({
                embeds: [embed],
                components: [this.createLanguageMenu()]
            });
            
            logger.info(`Language command executed by ${message.author.tag}`);
        } catch (error) {
            logger.error(`Error handling language command: ${error.message}`, error);
            message.reply(languageManager.translate('system.errorOccurred'));
        }
    }

    async handleButtonInteraction(interaction) {
        try {
            const broadcastMessage = this.broadcasts.get(interaction.user.id);
            if (!broadcastMessage) {
                return interaction.reply({
                    content: languageManager.translate('messages.sessionExpired'),
                    ephemeral: true
                });
            }

            if (interaction.customId.startsWith('target_')) {
                const target = interaction.customId.split('_')[1];
                await this.handleTargetSelection(interaction, target, broadcastMessage);
                return;
            }

            if (interaction.customId === 'bc_confirm') {
                await this.handleConfirmation(interaction, true);
                return;
            }
            
            if (interaction.customId === 'bc_cancel') {
                const lang = languageManager.getDefaultLanguageCode();
                const languages = languageManager.getAllLanguages();
                
                await interaction.update({ 
                    components: [], 
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.neutral)
                            .setTitle(languages[lang].embeds.broadcast.canceled)
                            .setDescription(languages[lang].messages.canceledMessage)
                    ]
                });
                
                logger.info(`Broadcast canceled by ${interaction.user.tag}`);
                
                this.broadcasts.delete(interaction.user.id);
                this.sessions.delete(interaction.user.id);
                return;
            }
        } catch (error) {
            logger.error(`Error handling button interaction: ${error.message}`, error);
            interaction.reply({
                content: languageManager.translate('system.errorOccurred'),
                ephemeral: true
            });
        }
    }

    async handleSelectMenuInteraction(interaction) {
        try {
            if (interaction.customId === 'select_language') {
                const selectedLang = interaction.values[0];
                languageManager.setDefaultLanguage(selectedLang);
                
                await interaction.update({
                    content: languageManager.translate('system.languageUpdated', 
                        languageManager.getLanguage().language.native),
                    components: []
                });
                
                logger.info(`Language set to ${selectedLang} by ${interaction.user.tag}`);
                return;
            }
            
            if (interaction.customId === 'select_role') {
                const broadcastMessage = this.broadcasts.get(interaction.user.id);
                if (!broadcastMessage) {
                    return interaction.reply({
                        content: languageManager.translate('messages.sessionExpired'),
                        ephemeral: true
                    });
                }
                
                await this.handleRoleSelection(interaction, interaction.values[0], broadcastMessage);
                return;
            }
            
            if (interaction.customId === 'select_user') {
                const broadcastMessage = this.broadcasts.get(interaction.user.id);
                if (!broadcastMessage) {
                    return interaction.reply({
                        content: languageManager.translate('messages.sessionExpired'),
                        ephemeral: true
                    });
                }
                
                await this.handleUserSelection(interaction, broadcastMessage);
                return;
            }
        } catch (error) {
            logger.error(`Error handling select menu interaction: ${error.message}`, error);
            interaction.reply({
                content: languageManager.translate('system.errorOccurred'),
                ephemeral: true
            });
        }
    }

    createTargetButtons() {
        const row = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId('target_all')
                    .setLabel(languageManager.translate('buttons.allMembers'))
                    .setStyle('PRIMARY'),
                
                new MessageButton()
                    .setCustomId('target_online')
                    .setLabel(languageManager.translate('buttons.onlineMembers'))
                    .setStyle('SUCCESS'),
                
                new MessageButton()
                    .setCustomId('target_offline')
                    .setLabel(languageManager.translate('buttons.offlineMembers'))
                    .setStyle('SECONDARY'),
                
                new MessageButton()
                    .setCustomId('bc_cancel')
                    .setLabel(languageManager.translate('buttons.cancel'))
                    .setStyle('DANGER')
            );
            
        return [row];
    }

    createLanguageMenu() {
        const languages = languageManager.getAllLanguages();
        const options = Object.values(languages).map(lang => {
            return {
                label: lang.language.name,
                description: lang.language.native,
                value: lang.language.code,
                default: lang.language.code === languageManager.getDefaultLanguageCode()
            };
        });
        
        return new MessageActionRow()
            .addComponents(
                new MessageSelectMenu()
                    .setCustomId('select_language')
                    .setPlaceholder(languageManager.translate('messages.selectLanguage'))
                    .addOptions(options)
            );
    }

    createConfirmationButtons() {
        const lang = languageManager.getLanguage();
        
        return new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId('bc_confirm')
                    .setLabel(lang.buttons.confirm.split(' ')[1])
                    .setEmoji('✅')
                    .setStyle('SUCCESS'),
                new MessageButton()
                    .setCustomId('bc_cancel')
                    .setLabel(lang.buttons.cancel.split(' ')[1])
                    .setEmoji('❌')
                    .setStyle('DANGER')
            );
    }

    async handleTargetSelection(interaction, target, broadcastMessage) {
        try {
            const lang = languageManager.getDefaultLanguageCode();
            const languages = languageManager.getAllLanguages();
            
            await interaction.guild.members.fetch({ withPresences: true });
            let members = interaction.guild.members.cache.filter(member => !member.user.bot);
            let targetMembers = null;
            let targetDescription = '';

            switch (target) {
                case 'all':
                    targetMembers = members;
                    targetDescription = languages[lang].buttons.allMembers;
                    break;

                case 'online':
                    targetMembers = members.filter(member => 
                        member.presence && 
                        (member.presence.status === 'online' || 
                         member.presence.status === 'idle' || 
                         member.presence.status === 'dnd')
                    );
                    targetDescription = languages[lang].buttons.onlineMembers;
                    break;

                case 'offline':
                    targetMembers = members.filter(member => 
                        !member.presence || member.presence.status === 'offline'
                    );
                    targetDescription = languages[lang].buttons.offlineMembers;
                    break;

                case 'role':
                    const roleRow = new MessageActionRow()
                        .addComponents(
                            new MessageSelectMenu()
                                .setCustomId('select_role')
                                .setPlaceholder(languages[lang].messages.selectRole)
                                .addOptions(
                                    interaction.guild.roles.cache
                                        .filter(role => !role.managed && role.id !== interaction.guild.id)
                                        .map(role => ({
                                            label: role.name.substring(0, 25),
                                            value: role.id,
                                            description: `Members: ${role.members.size}`
                                        }))
                                        .slice(0, 25)
                                )
                        );
                    
                    await interaction.update({
                        embeds: [
                            new MessageEmbed()
                                .setColor(config.colors.primary)
                                .setTitle(languages[lang].embeds.broadcast.title)
                                .setDescription(languages[lang].messages.selectRole)
                        ],
                        components: [roleRow]
                    });
                    return;

                case 'user':
                    const userRow = new MessageActionRow()
                        .addComponents(
                            new MessageSelectMenu()
                                .setCustomId('select_user')
                                .setPlaceholder(languages[lang].messages.selectUser)
                                .addOptions(
                                    interaction.guild.members.cache
                                        .filter(member => !member.user.bot)
                                        .map(member => ({
                                            label: member.user.username.substring(0, 25),
                                            value: member.id,
                                            description: member.nickname ? member.nickname.substring(0, 50) : 'No nickname'
                                        }))
                                        .slice(0, 25)
                                )
                        );
                    
                    await interaction.update({
                        embeds: [
                            new MessageEmbed()
                                .setColor(config.colors.primary)
                                .setTitle(languages[lang].embeds.broadcast.title)
                                .setDescription(languages[lang].messages.selectUser)
                        ],
                        components: [userRow]
                    });
                    return;
            }

            if (targetMembers) {
                this.sessions.set(interaction.user.id, {
                    ...this.sessions.get(interaction.user.id),
                    targetMembers
                });

                const confirmEmbed = new MessageEmbed()
                    .setColor(config.colors.primary)
                    .setTitle(languages[lang].embeds.broadcast.title)
                    .addField(
                        languages[lang].embeds.broadcast.messageContent,
                        `\`\`\`${broadcastMessage.length > MAX_PREVIEW_LENGTH ? 
                            broadcastMessage.slice(0, MAX_PREVIEW_LENGTH) + '...' : 
                            broadcastMessage}\`\`\``
                    )
                    .addField(
                        languages[lang].embeds.broadcast.targetAudience,
                        `${targetDescription} (${targetMembers.size} ${languages[lang].messages.members})`
                    )
                    .setFooter(`Broadcast System • Multiple Clients: ${broadcastManager.clients.length}`)
                    .setTimestamp();

                await interaction.update({
                    embeds: [confirmEmbed],
                    components: [this.createConfirmationButtons()]
                });
                
                logger.info(`Target selected: ${targetDescription} with ${targetMembers.size} members by ${interaction.user.tag}`);
            }
        } catch (error) {
            logger.error(`Error in handleTargetSelection: ${error.message}`, error);
            await interaction.reply({
                content: 'An error occurred while selecting the target audience. Please try again.',
                ephemeral: true
            });
        }
    }

    async handleRoleSelection(interaction, roleId, broadcastMessage) {
        try {
            const lang = languageManager.getDefaultLanguageCode();
            const languages = languageManager.getAllLanguages();
            
            const role = interaction.guild.roles.cache.get(roleId);
            
            if (!role) {
                return interaction.update({
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.error)
                            .setTitle(languages[lang].embeds.errors.missingRole)
                            .setDescription(languages[lang].messages.missingRole)
                    ],
                    components: []
                });
            }

            await interaction.guild.members.fetch();
            const members = interaction.guild.members.cache
                .filter(member => !member.user.bot && member.roles.cache.has(role.id));

            this.sessions.set(interaction.user.id, {
                ...this.sessions.get(interaction.user.id),
                targetMembers: members
            });

            const confirmEmbed = new MessageEmbed()
                .setColor(config.colors.primary)
                .setTitle(languages[lang].embeds.broadcast.title)
                .addField(
                    languages[lang].embeds.broadcast.messageContent,
                    `\`\`\`${broadcastMessage.length > MAX_PREVIEW_LENGTH ? 
                        broadcastMessage.slice(0, MAX_PREVIEW_LENGTH) + '...' : 
                        broadcastMessage}\`\`\``
                )
                .addField(
                    languages[lang].embeds.broadcast.targetAudience,
                    `${languages[lang].buttons.roleMembers}: ${role.name} (${members.size} ${languages[lang].messages.members})`
                )
                .setFooter(`Broadcast System • Multiple Clients: ${broadcastManager.clients.length}`)
                .setTimestamp();

            await interaction.update({
                embeds: [confirmEmbed],
                components: [this.createConfirmationButtons()]
            });
            
            logger.info(`Role selected: ${role.name} with ${members.size} members by ${interaction.user.tag}`);
        } catch (error) {
            logger.error(`Error in handleRoleSelection: ${error.message}`, error);
            await interaction.reply({
                content: 'An error occurred while selecting the role. Please try again.',
                ephemeral: true
            });
        }
    }

    async handleUserSelection(interaction, userId, broadcastMessage) {
        try {
            const lang = languageManager.getDefaultLanguageCode();
            const languages = languageManager.getAllLanguages();
            
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            
            if (!member) {
                return interaction.update({
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.error)
                            .setTitle(languages[lang].embeds.errors.userNotFound)
                            .setDescription(languages[lang].messages.userNotFound)
                    ],
                    components: []
                });
            }

            const members = new Map();
            members.set(member.id, member);
            this.sessions.set(interaction.user.id, {
                ...this.sessions.get(interaction.user.id),
                targetMembers: members
            });

            const confirmEmbed = new MessageEmbed()
                .setColor(config.colors.primary)
                .setTitle(languages[lang].embeds.broadcast.title)
                .addField(
                    languages[lang].embeds.broadcast.messageContent,
                    `\`\`\`${broadcastMessage.length > MAX_PREVIEW_LENGTH ? 
                        broadcastMessage.slice(0, MAX_PREVIEW_LENGTH) + '...' : 
                        broadcastMessage}\`\`\``
                )
                .addField(
                    languages[lang].embeds.broadcast.targetAudience,
                    `${languages[lang].buttons.specificMember}: ${member.user.tag}`
                )
                .setFooter(`Broadcast System • Multiple Clients: ${broadcastManager.clients.length}`)
                .setTimestamp();

            await interaction.update({
                embeds: [confirmEmbed],
                components: [this.createConfirmationButtons()]
            });
            
            logger.info(`User selected: ${member.user.tag} by ${interaction.user.tag}`);
        } catch (error) {
            logger.error(`Error in handleUserSelection: ${error.message}`, error);
            await interaction.reply({
                content: 'An error occurred while selecting the user. Please try again.',
                ephemeral: true
            });
        }
    }

    async handleConfirmation(interaction, confirmed) {
        try {
            const lang = languageManager.getDefaultLanguageCode();
            const languages = languageManager.getAllLanguages();
            
            const broadcastMessage = this.broadcasts.get(interaction.user.id);
            const session = this.sessions.get(interaction.user.id);
            
            if (!broadcastMessage || !session || !session.targetMembers) {
                return interaction.update({
                    content: languages[lang].messages.sessionExpired,
                    components: []
                });
            }

            if (confirmed) {
                const statusEmbed = new MessageEmbed()
                    .setColor(config.colors.warning)
                    .setTitle(languages[lang].embeds.broadcast.processing)
                    .setDescription(languages[lang].messages.startingBroadcast.replace('{0}', session.targetMembers.size))
                    .setFooter(`Broadcast System • Multiple Clients: ${broadcastManager.clients.length}`)
                    .setTimestamp();
                    
                await interaction.update({ 
                    components: [], 
                    embeds: [statusEmbed]
                });
                
                logger.info(`Broadcast confirmed by ${interaction.user.tag} to ${session.targetMembers.size} members`);
                
                await broadcastManager.startBroadcast({
                    interaction,
                    members: session.targetMembers,
                    message: broadcastMessage,
                    lang,
                    languages
                });
            } else {
                await interaction.update({ 
                    components: [], 
                    embeds: [
                        new MessageEmbed()
                            .setColor(config.colors.neutral)
                            .setTitle(languages[lang].embeds.broadcast.canceled)
                            .setDescription(languages[lang].messages.canceledMessage)
                    ]
                });
                
                logger.info(`Broadcast canceled by ${interaction.user.tag}`);
            }

            this.broadcasts.delete(interaction.user.id);
            this.sessions.delete(interaction.user.id);
        } catch (error) {
            logger.error(`Error in handleConfirmation: ${error.message}`, error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again.',
                ephemeral: true
            });
        }
    }
}

module.exports = new BroadcastController();