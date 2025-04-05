const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLogger = (context) => {
    const getTimestamp = () => {
        return new Date().toISOString().replace('T', ' ').substring(0, 19);
    };
    
    const formatMessage = (message) => {
        return `[${getTimestamp()}] [${context}] ${message}`;
    };
    
    return {
        info: (message, ...args) => {
            console.log('\x1b[32m%s\x1b[0m', formatMessage(message), ...args);
        },
        warn: (message, ...args) => {
            console.log('\x1b[33m%s\x1b[0m', formatMessage(message), ...args);
        },
        error: (message, ...args) => {
            console.error('\x1b[31m%s\x1b[0m', formatMessage(message), ...args);
        },
        debug: (message, ...args) => {
            const DEBUG_MODE = false;
            if (DEBUG_MODE) {
                console.log('\x1b[36m%s\x1b[0m', formatMessage(message), ...args);
            }
        }
    };
};

const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const generateId = () => {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
};

const createProgressBar = (percent, size = 10) => {
    const filledCount = Math.floor((percent / 100) * size);
    return '█'.repeat(filledCount) + '░'.repeat(size - filledCount);
};

const formatTime = (ms) => {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
};

module.exports = {
    sleep,
    createLogger,
    formatNumber,
    generateId,
    createProgressBar,
    formatTime
};