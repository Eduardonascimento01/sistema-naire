-- ==============================================================================
-- ONG NAIRE
-- Data de Atualização: 06/04/2026
-- Descrição: Estrutura oficial do Banco de Dados Relacional (MySQL)
-- ==============================================================================
-- Criação do banco de dados
 CREATE DATABASE IF NOT EXISTS ong_naire;
 USE ong_naire;

-- 1. Tabela de Voluntários (Responsável também pelo Login do sistema)
CREATE TABLE IF NOT EXISTS voluntarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    nivel_acesso ENUM('admin', 'comum') DEFAULT 'comum'
);

-- 2. Tabela de Padrinhos (Independente, aguardando vínculo com menores)
CREATE TABLE IF NOT EXISTS padrinhos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    telefone VARCHAR(20),
    observacoes TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_doacao DATE
);

-- 3. Tabela de Eventos (Campanhas de doação)
CREATE TABLE IF NOT EXISTS eventos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    data_evento DATE
);

-- 4. Tabela de Responsáveis (As Mães/Famílias)
CREATE TABLE IF NOT EXISTS responsaveis (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome_mae VARCHAR(255) NOT NULL,
    rg VARCHAR(20),
    cpf VARCHAR(20),
    titulo_eleitor VARCHAR(50),
    endereco TEXT,
    fones_contato VARCHAR(100),
    mae_trabalha VARCHAR(100),
    pai_trabalha VARCHAR(100),
    aceite_lgpd TINYINT(1) DEFAULT 0,
    data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    voluntario_cadastro_id INT,
    voluntario_responsavel_id INT,
    status VARCHAR(20) DEFAULT 'ativo',
    validado TINYINT(1) DEFAULT 0,
    outra_ong VARCHAR(150),
    foto_familia_path VARCHAR(255) DEFAULT 'uploads/default-familia.png',
    foto_url VARCHAR(255) DEFAULT 'icon-mae.png',
    
    -- Chaves Estrangeiras apontando para a tabela de voluntários
    FOREIGN KEY (voluntario_cadastro_id) REFERENCES voluntarios(id) ON DELETE SET NULL,
    FOREIGN KEY (voluntario_responsavel_id) REFERENCES voluntarios(id) ON DELETE SET NULL
);

-- 5. Tabela de Menores (Crianças vinculadas aos Responsáveis)
CREATE TABLE IF NOT EXISTS menores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    responsavel_id INT NOT NULL,
    nome_completo VARCHAR(255) NOT NULL,
    data_nascimento DATE,
    tamanho_roupa VARCHAR(10),
    tamanho_sapato VARCHAR(10),
    padrinho_id INT,
    sexo VARCHAR(1) DEFAULT '-',
    foto_crianca_path VARCHAR(255) DEFAULT 'uploads/default-crianca.png',
    foto_url VARCHAR(255) DEFAULT 'icon-crianca.png',
    
    -- Chaves Estrangeiras (Se a mãe for apagada, as crianças somem em cascata)
    FOREIGN KEY (responsavel_id) REFERENCES responsaveis(id) ON DELETE CASCADE,
    FOREIGN KEY (padrinho_id) REFERENCES padrinhos(id) ON DELETE SET NULL
);

-- 6. Tabela de Entregas (Relacionamento N:M entre Eventos e Famílias)
CREATE TABLE IF NOT EXISTS entregas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    evento_id INT NOT NULL,
    familia_id INT NOT NULL,
    data_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
    FOREIGN KEY (familia_id) REFERENCES responsaveis(id) ON DELETE CASCADE
);

-- 7. Tabela de Logs de Auditoria (Isolada por segurança)
CREATE TABLE IF NOT EXISTS logs_auditoria (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(100),
    acao VARCHAR(50),
    detalhes VARCHAR(255),
    data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
);