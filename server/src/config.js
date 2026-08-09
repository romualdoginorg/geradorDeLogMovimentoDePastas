const path = require('path');
const fs = require('fs');

const baseDir = path.join(__dirname, '..');
const configPath = path.join(baseDir, 'config', 'config.json');
const defaultPath = path.join(baseDir, 'config', 'config.default.json');

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source || {})) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function carregarConfig() {
  let config = {};
  if (fs.existsSync(defaultPath)) {
    config = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
  }
  if (fs.existsSync(configPath)) {
    const user = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = deepMerge(config, user);
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }
  return config;
}

module.exports = { carregarConfig, baseDir };