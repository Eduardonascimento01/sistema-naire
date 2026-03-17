
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Conexão com o Banco de Dados
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'univesp123*',
    database: 'ong_naire'
});

db.connect((erro) => {
    if (erro) console.error('Erro no MySQL:', erro);
    else console.log('✅ MySQL Conectado!');
});

// 2. ROTA DE LOGIN
app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    if (usuario === 'admin' && senha === 'ong123') {
        res.status(200).json({ mensagem: 'Login aprovado!' });
    } else {
        res.status(401).json({ erro: 'Senha incorreta' });
    }
});

// 3. ROTA DE CADASTRO (Agora salva a Mãe e as Crianças juntas!)
app.post('/cadastro', (req, res) => {
    const { responsavel, menores } = req.body;
    
    // Primeiro: Salva a Mãe
    const sqlMae = 'INSERT INTO responsaveis (nome_mae, rg, cpf, endereco, fones_contato) VALUES (?, ?, ?, ?, ?)';
    db.query(sqlMae, [responsavel.nome_mae, responsavel.rg, responsavel.cpf, responsavel.endereco, responsavel.fones], (erro, resultado) => {
        if (erro) {
            console.error('Erro ao salvar mãe:', erro);
            return res.status(500).json({ erro: 'Erro ao salvar mãe' });
        }
        
        const responsavelId = resultado.insertId; // Pega o ID que o banco gerou para a mãe

        // Segundo: Se tiver crianças, salva elas amarradas ao ID da mãe
        if (menores && menores.length > 0) {
            const sqlCriancas = 'INSERT INTO menores (responsavel_id, nome_completo, data_nascimento, tamanho_roupa, tamanho_sapato) VALUES ?';
            
            // Prepara a listinha de crianças no formato que o MySQL exige
            const valoresCriancas = menores.map(crianca => [
                responsavelId, crianca.nome, crianca.data, crianca.roupa, crianca.sapato
            ]);
            
            db.query(sqlCriancas, [valoresCriancas], (erro2) => {
                if (erro2) {
                    console.error('Erro ao salvar crianças:', erro2);
                    return res.status(500).json({ erro: 'Mãe salva, mas erro ao salvar crianças' });
                }
                console.log('📝 Mãe e crianças salvas com sucesso!');
                res.status(201).json({ mensagem: 'Ficha completa salva!' });
            });
        } else {
            // Se não preencheu nenhuma criança, salva só a mãe e avisa que deu certo
            console.log('📝 Apenas a mãe foi salva (sem crianças).');
            res.status(201).json({ mensagem: 'Ficha salva (sem menores).' });
        }
    });
});

app.listen(3000, () => {
    console.log('🚀 Servidor rodando na porta 3000.');
});