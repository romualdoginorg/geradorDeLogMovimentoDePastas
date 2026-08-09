const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');
const { baseDir } = require('./config');

function criarLogger(config) {
  const logDir = path.join(baseDir, config.log?.diretorio || 'logs');

  const transportArquivo = new winston.transports.DailyRotateFile({
    filename: path.join(logDir, config.log?.arquivo || 'monitor-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: config.log?.maxArquivos || '14d',
    level: config.log?.nivel || 'info'
  });

  const logger = winston.createLogger({
    level: config.log?.nivel || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      transportArquivo,
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ]
  });

  return logger;
}

module.exports = { criarLogger };