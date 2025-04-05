const config = require('../../config');
const { MessageEmbed } = require('discord.js');
const { sleep, createLogger } = require('../utils/helpers');

const logger = createLogger('BroadcastManager');

class BroadcastManager {
    constructor() {
        this.clients = [];
        this.activeJobs = new Map();
        this.clientLoadMap = new Map();
    }

    initialize(clients) {
        this.clients = clients;
        
        clients.forEach(client => {
            this.clientLoadMap.set(client.user.id, 0);
        });
        
        logger.info(`BroadcastManager initialized with ${clients.length} clients`);
        return this;
    }

    getLeastBusyClient() {
        if (this.clients.length === 0) {
            throw new Error('No clients available');
        }
        
        const clientEntries = [...this.clientLoadMap.entries()];
        clientEntries.sort((a, b) => a[1] - b[1]);
        
        const leastBusyClientId = clientEntries[0][0];
        return this.clients.find(client => client.user.id === leastBusyClientId);
    }

    incrementLoad(client) {
        const currentLoad = this.clientLoadMap.get(client.user.id) || 0;
        this.clientLoadMap.set(client.user.id, currentLoad + 1);
    }

    decrementLoad(client) {
        const currentLoad = this.clientLoadMap.get(client.user.id) || 0;
        if (currentLoad > 0) {
            this.clientLoadMap.set(client.user.id, currentLoad - 1);
        }
    }

    async startBroadcast(options) {
        const { interaction, members, message, lang, languages } = options;
        
        const totalMembers = members.size;
        const results = {
            totalMembers,
            successCount: 0,
            failureCount: 0,
            failedMembers: [],
            startTime: Date.now(),
            lastUIUpdate: Date.now(),
            processedCount: 0
        };
        
        const totalClients = this.clients.length;
        const requestsPerSecond = config.broadcast.requestsPerSecond * totalClients;
        const estimatedTimePerMember = (config.broadcast.cooldownTime + config.broadcast.memberCooldown) / totalClients;
        const totalTime = estimatedTimePerMember * totalMembers;
        const minutes = Math.floor(totalTime / 60000);
        const seconds = Math.floor((totalTime % 60000) / 1000);

        const memberChunks = this.distributeMembers([...members.values()], totalClients);
        
        const progressEmbed = new MessageEmbed()
            .setColor(config.colors.primary)
            .setTitle(languages[lang].embeds.broadcast.processing)
            .setDescription(languages[lang].messages.startingBroadcast
                .replace('{0}', totalMembers))
            .addField('📊 Progress', '▪️ Initializing... 0%')
            .addField('🎯 Target Members', `${totalMembers}`, true)
            .addField('⏱️ Estimated Time', `${minutes}m ${seconds}s`, true)
            .addField('⚡ Speed', `~${requestsPerSecond} members/sec`, true)
            .addField('🤖 Clients', `${totalClients} bots distributing work`, true)
            .setFooter(`Broadcast System by Wick Studio • ${this.clients.map(c => c.user.tag).join(' | ')}`)
            .setTimestamp();

        await interaction.editReply({ embeds: [progressEmbed] });
        
        logger.info(`Starting broadcast to ${totalMembers} members using ${totalClients} clients`);
        
        const promises = memberChunks.map((chunk, index) => 
            this.processMemberChunk({
                client: this.clients[index % totalClients],
                members: chunk,
                message,
                results,
                interaction,
                lang,
                languages
            })
        );
        
        await Promise.all(promises);
        
        logger.info(`Broadcast completed. Success: ${results.successCount}, Failed: ${results.failureCount}`);
        
        return this.finalizeBroadcast({
            interaction,
            results,
            message,
            lang,
            languages
        });
    }
    
    distributeMembers(members, clientCount) {
        const chunks = Array(clientCount).fill().map(() => []);
        
        members.forEach((member, index) => {
            chunks[index % clientCount].push(member);
        });
        
        return chunks;
    }
    
    async processMemberChunk(options) {
        const {
            client,
            members,
            message,
            results,
            interaction,
            lang,
            languages
        } = options;
        
        logger.info(`Client ${client.user.tag} processing ${members.length} members`);
        
        for (const member of members) {
            try {
                this.incrementLoad(client);
                const messageWithMention = `${message}\n\n<@${member.id}>`;
                
                const user = await client.users.fetch(member.id).catch(() => null);
                
                if (!user) {
                    throw new Error("Could not fetch user");
                }
                
                await user.send(messageWithMention);
                results.successCount++;
                
                results.processedCount++;
                const progress = Math.floor((results.processedCount / results.totalMembers) * 100);
                const now = Date.now();

                if (progress % 5 === 0 || now - results.lastUIUpdate > 3000 || results.processedCount === 1) {
                    results.lastUIUpdate = now;
                    await this.updateProgressUI({
                        interaction,
                        results,
                        progress,
                        lang,
                        languages
                    });
                }
            } catch (error) {
                results.failureCount++;
                results.failedMembers.push(`<@${member.id}>`);
                
                let errorReason = "Unknown error occurred";
                
                if (error.code === 50007) {
                    errorReason = "DMs are closed";
                } else if (error.code === 50013) {
                    errorReason = "Missing permissions";
                } else if (error.code === 10003) {
                    errorReason = "Unknown user";
                } else if (error.message) {
                    errorReason = error.message.substring(0, 100);
                }
                
                logger.error(`Client ${client.user.tag} failed to send message to ${member.user?.tag || member.id}: ${errorReason}`);
                results.processedCount++;
            } finally {
                this.decrementLoad(client);
                
                await sleep(config.broadcast.cooldownTime / this.clients.length);
            }
        }
    }
    
    async updateProgressUI(options) {
        const { interaction, results, progress, lang, languages } = options;
        
        const getProgressBar = (percent) => {
            const filledCount = Math.floor(percent / 10);
            return '█'.repeat(filledCount) + '░'.repeat(10 - filledCount);
        };
        
        const elapsedTime = Date.now() - results.startTime;
        const processedCount = results.processedCount;
        const remainingCount = results.totalMembers - processedCount;
        
        let remainingTime = 0;
        let remainingMinutes = 0;
        let remainingSeconds = 0;
        
        if (processedCount > 0) {
            const avgTimePerMember = elapsedTime / processedCount;
            remainingTime = avgTimePerMember * remainingCount;
            remainingMinutes = Math.floor(remainingTime / 60000);
            remainingSeconds = Math.floor((remainingTime % 60000) / 1000);
        }
        
        const currentSpeed = processedCount > 0 
            ? Math.round(processedCount / (elapsedTime / 1000)) 
            : 0;
            
        const progressEmbed = new MessageEmbed()
            .setColor(config.colors.primary)
            .setTitle(languages[lang].embeds.broadcast.processing)
            .setDescription(`${getProgressBar(progress)} **${progress}%**`)
            .addField('📊 Status', 
                `▪️ Processing: **${processedCount}/${results.totalMembers}**\n` +
                `✅ Success: **${results.successCount}**\n` +
                `❌ Failed: **${results.failureCount}**`)
            .addField('⏱️ Time Remaining', `${remainingMinutes}m ${remainingSeconds}s`, true)
            .addField('⏰ Elapsed Time', `${Math.floor(elapsedTime / 60000)}m ${Math.floor((elapsedTime % 60000) / 1000)}s`, true)
            .addField('⚡ Current Speed', `~${currentSpeed} members/sec`, true)
            .addField('🤖 Active Clients', `${this.clients.length} bots`, true)
            .setFooter(`Broadcast System by Wick Studio • ${this.clients.map(c => c.user.tag).join(' | ')}`)
            .setTimestamp();
        
        try {
            await interaction.editReply({ embeds: [progressEmbed] });
        } catch (error) {
            logger.error('Failed to update progress UI:', error);
        }
    }
    
    async finalizeBroadcast(options) {
        const { interaction, results, message, lang, languages } = options;
        
        try {
            const getProgressBar = (percent) => {
                const filledCount = Math.floor(percent / 10);
                return '█'.repeat(filledCount) + '░'.repeat(10 - filledCount);
            };
            
            const totalTime = Date.now() - results.startTime;
            const averageSpeed = Math.round(results.totalMembers / (totalTime / 1000));
            
            const reportEmbed = this.createReportEmbed(results, message, lang, languages);
            
            if (config.server.reportChannelId) {
                try {
                    const reportChannel = await this.clients[0].channels.fetch(config.server.reportChannelId);
                    if (reportChannel) {
                        await reportChannel.send({ embeds: [reportEmbed] });
                    }
                } catch (error) {
                    logger.error(`Error sending broadcast report: ${error.message}`, error);
                }
            }

            const completionEmbed = new MessageEmbed()
                .setColor(config.colors.success)
                .setTitle(languages[lang].embeds.broadcast.completed)
                .setDescription(languages[lang].messages.completionMessage)
                .addFields([
                    {
                        name: '📊 Results', 
                        value: `${getProgressBar(Math.floor((results.successCount / results.totalMembers) * 100))} ${Math.floor((results.successCount / results.totalMembers) * 100)}%\n\n` +
                            `▪️ ${languages[lang].embeds.broadcast.totalMembers}: **${results.totalMembers}**\n` +
                            `✅ ${languages[lang].embeds.broadcast.successful}: **${results.successCount}**\n` +
                            `❌ ${languages[lang].embeds.broadcast.failed}: **${results.failureCount}**`
                    },
                    {
                        name: '⏰ Total Time', 
                        value: `${Math.floor(totalTime / 60000)}m ${Math.floor((totalTime % 60000) / 1000)}s`, 
                        inline: true
                    },
                    {
                        name: '⚡ Average Speed', 
                        value: `~${averageSpeed} members/sec`, 
                        inline: true
                    }
                ])
                .setFooter({ text: `${languages[lang].system.broadcastSystem} • ${this.clients.map(c => c.user.tag).join(' | ')}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [completionEmbed] });
        } catch (error) {
            logger.error('Failed to finalize broadcast:', error);
        }
        
        return results;
    }

    createReportEmbed(results, message, lang, languages) {
        const { successCount, failureCount, failedMembers } = results;
        
        const reportEmbed = new MessageEmbed()
            .setColor(config.colors.warning)
            .setTitle('📊 ' + languages[lang].embeds.broadcast.report)
            .setDescription(`Broadcast report for ${results.totalMembers} members.`)
            .addFields([
                {
                    name: '📝 Message', 
                    value: message.length > 200 ? 
                        message.slice(0, 200) + '...' : 
                        message
                },
                {
                    name: '📊 Results',
                    value: `▪️ Total Members: **${results.totalMembers}**\n` +
                        `✅ Successful: **${successCount}**\n` +
                        `❌ Failed: **${failureCount}**`
                }
            ])
            .setFooter({ text: `Broadcast System by Wick Studio • ${this.clients.map(c => c.user.tag).join(' | ')}` })
            .setTimestamp();

        if (failedMembers.length > 0) {
            const MAX_EMBED_FIELD_LENGTH = 1024;
            const MAX_MEMBERS_PER_FIELD = 30;
            const MAX_FAILED_FIELDS = 5;
            
            const formattedFailedMembers = failedMembers.map(member => {
                if (typeof member === 'string') {
                    if (member.startsWith('<@')) {
                        const userId = member.replace(/[<@!>]/g, '');
                        try {
                            const user = this.clients[0].users.cache.get(userId);
                            if (user) return `${user.username}#${user.discriminator}`;
                        } catch (e) {}
                    }
                    return member;
                }
                
                try {
                    if (member.user) return `${member.user.username}#${member.user.discriminator}`;
                    if (member.username) return `${member.username}#${member.discriminator}`;
                } catch (e) {}
                
                return String(member);
            });
            
            if (failedMembers.length > MAX_MEMBERS_PER_FIELD * MAX_FAILED_FIELDS) {
                reportEmbed.addFields([{
                    name: languages[lang].embeds.broadcast.failedMembers,
                    value: `Too many failed members (${failedMembers.length}) to display. First ${MAX_MEMBERS_PER_FIELD} members:\n` + 
                           formattedFailedMembers.slice(0, MAX_MEMBERS_PER_FIELD).join(', ')
                }]);
                
                reportEmbed.addFields([{
                    name: '📋 Full List',
                    value: 'Check the console logs for the complete list of failed members.'
                }]);
                
                logger.info(`Failed members (${failedMembers.length}): ${formattedFailedMembers.join(', ')}`);
            } else {
                const chunks = [];
                let currentChunk = [];
                
                for (const member of formattedFailedMembers) {
                    if (currentChunk.length >= MAX_MEMBERS_PER_FIELD) {
                        chunks.push(currentChunk);
                        currentChunk = [member];
                    } else {
                        currentChunk.push(member);
                    }
                }
                
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                }
                
                for (let i = 0; i < Math.min(chunks.length, MAX_FAILED_FIELDS); i++) {
                    reportEmbed.addFields([{
                        name: i === 0 ? 
                            languages[lang].embeds.broadcast.failedMembers : 
                            languages[lang].embeds.broadcast.failedMembersContinued + ` (${i+1}/${chunks.length})`,
                        value: chunks[i].join(', ')
                    }]);
                }
                
                if (chunks.length > MAX_FAILED_FIELDS) {
                    const remainingCount = failedMembers.length - (MAX_FAILED_FIELDS * MAX_MEMBERS_PER_FIELD);
                    reportEmbed.addFields([{
                        name: '📋 Additional Failed Members',
                        value: `... and ${remainingCount} more. Check the console logs for the full list.`
                    }]);
                    
                    logger.info(`All failed members (${failedMembers.length}): ${formattedFailedMembers.join(', ')}`);
                }
            }
        }
        
        return reportEmbed;
    }
}

module.exports = new BroadcastManager();
