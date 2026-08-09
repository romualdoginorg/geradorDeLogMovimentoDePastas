const path = require('path');
const fs = require('fs');

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

const configPath = path.join(baseDir, 'config', 'config.json');
const defaultConfigPath = path.join(baseDir, 'config', 'config.default.json');

function carregarConfig() {
  let config = {};

  // Carrega o default
  if (fs.existsSync(defaultConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
    } catch (e) {
      console.error('Erro ao ler config.default.json:', e.message);
    }
  }

  // Sobrescreve com config.json se existir
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = deepMerge(config, userConfig);
    } catch (e) {
      console.error('Erro ao ler config.json:', e.message);
    }
  } else {
    // Cria config.json a partir do default na primeira execução
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      console.log('✅ config.json criado a partir do default.');
    } catch (e) {
      console.error('Não foi possível criar config.json:', e.message);
    }
  }

  return config;
}

function salvarConfig(novaConfig) {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(novaConfig, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Erro ao salvar config.json:', e.message);
    return false;
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
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

module.exports = {
  carregarConfig,
  salvarConfig,
  baseDir,
  configPath
};