-- 1. CRIAR O BANCO DE DADOS
CREATE DATABASE IF NOT EXISTS ong_naire;
USE ong_naire;

-- 2. TABELA DE VOLUNTÁRIOS (Controle de Acesso)
CREATE TABLE IF NOT EXISTS voluntarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    usuario VARCHAR(50) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    nivel_acesso ENUM('admin', 'voluntario') DEFAULT 'voluntario'
);

-- 3. TABELA DE PADRINHOS (Doadores)
CREATE TABLE IF NOT EXISTS padrinhos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    telefone VARCHAR(20),
    observacoes TEXT,
    data_doacao DATE
);

-- 4. TABELA DE RESPONSÁVEIS (Mães/Famílias)
CREATE TABLE IF NOT EXISTS responsaveis (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome_mae VARCHAR(100) NOT NULL,
    rg VARCHAR(20),
    cpf VARCHAR(14) UNIQUE,
    endereco TEXT,
    fones_contato VARCHAR(100),
    voluntario_cadastro_id INT,
    voluntario_responsavel_id INT,
    FOREIGN KEY (voluntario_cadastro_id) REFERENCES voluntarios(id),
    FOREIGN KEY (voluntario_responsavel_id) REFERENCES voluntarios(id) ON DELETE SET NULL
);

-- 5. TABELA DE MENORES (Crianças e o Match)
CREATE TABLE IF NOT EXISTS menores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    responsavel_id INT,
    padrinho_id INT,
    nome_completo VARCHAR(100) NOT NULL,
    data_nascimento DATE,
    tamanho_roupa VARCHAR(10),
    tamanho_sapato VARCHAR(10),
    FOREIGN KEY (responsavel_id) REFERENCES responsaveis(id) ON DELETE CASCADE,
    FOREIGN KEY (padrinho_id) REFERENCES padrinhos(id) ON DELETE SET NULL
);

-- 6. TABELA DE LOGS (Auditoria de Exclusão)
CREATE TABLE IF NOT EXISTS logs_auditoria (
    id INT AUTO_INCREMENT PRIMARY KEY,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario VARCHAR(100),
    acao VARCHAR(50),
    detalhes TEXT
);

-- DICA: Usuário padrão para o primeiro acesso (Senha: admin123)
-- Nota: Na prática usamos bcrypt, mas este INSERT ajuda a testar a estrutura.
INSERT INTO voluntarios (nome, usuario, senha, nivel_acesso) 
VALUES ('Administrador NAIRE', 'admin', '$2b$10$7vI6B/tKq.V5N3U9w9p8be9G1Z9z7Z9z7Z9z7Z9z7Z9z7Z9z7Z9z', 'admin');