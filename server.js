const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt'); // <-- Nossa nova ferramenta de segurança!

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 1. CONEXÃO COM O BANCO DE DADOS ---
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'univesp123*', 
    database: 'ong_naire'
});

db.connect((erro) => {
    if (erro) console.error('Erro no MySQL:', erro);
    else console.log('✅ MySQL Conectado com sucesso!');
});

// --- 2. NOVA ROTA: CADASTRAR VOLUNTÁRIO ---
// (No futuro, faremos uma tela HTML só para o Admin usar essa rota)
app.post('/cadastrar-voluntario', async (req, res) => {
    const { nome, usuario, senha, nivel_acesso } = req.body;

    try {
        // Pega a senha digitada e transforma em um código indecifrável
        const senhaCriptografada = await bcrypt.hash(senha, 10);
        
        const sql = 'INSERT INTO voluntarios (nome, usuario, senha, nivel_acesso) VALUES (?, ?, ?, ?)';

        // Salva no banco. Se a pessoa não enviar nível, vira 'voluntario' por padrão
        db.query(sql, [nome, usuario, senhaCriptografada, nivel_acesso || 'voluntario'], (erro) => {
            if (erro) {
                console.error('Erro ao cadastrar:', erro);
                return res.status(500).json({ erro: 'Erro ao cadastrar. O usuário já existe?' });
            }
            res.status(201).json({ mensagem: 'Voluntário cadastrado com segurança!' });
        });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro interno no servidor' });
    }
});

// --- 3. ROTA DE LOGIN ATUALIZADA ---
// Agora ela busca no banco de dados de verdade!
app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;

    const sql = 'SELECT * FROM voluntarios WHERE usuario = ?';

    db.query(sql, [usuario], async (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro no banco de dados' });

        // Se a lista de resultados for vazia, o usuário não existe
        if (resultados.length === 0) {
            return res.status(401).json({ erro: 'Usuário não encontrado' });
        }

        const voluntario = resultados[0];

        // Compara a senha que a pessoa digitou com o código maluco salvo no banco
        const senhaCorreta = await bcrypt.compare(senha, voluntario.senha);

        if (senhaCorreta) {
            res.status(200).json({ 
                mensagem: 'Login aprovado!', 
                nivel: voluntario.nivel_acesso,
                nome: voluntario.nome 
            });
        } else {
            res.status(401).json({ erro: 'Senha incorreta' });
        }
    });
});

// --- 4. ROTA DE CADASTRO DE FAMÍLIAS ---
app.post('/cadastro', (req, res) => {
    const { responsavel, menores } = req.body;
    const sqlMae = 'INSERT INTO responsaveis (nome_mae, rg, cpf, endereco, fones_contato) VALUES (?, ?, ?, ?, ?)';
    
    db.query(sqlMae, [responsavel.nome_mae, responsavel.rg, responsavel.cpf, responsavel.endereco, responsavel.fones], (erro, resultado) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao salvar responsável.' });
        
        const responsavelId = resultado.insertId;

        if (menores && menores.length > 0) {
            const sqlCriancas = 'INSERT INTO menores (responsavel_id, nome_completo, data_nascimento, tamanho_roupa, tamanho_sapato) VALUES ?';
            const valoresCriancas = menores.map(c => [responsavelId, c.nome, c.data, c.roupa, c.sapato]);
            
            db.query(sqlCriancas, [valoresCriancas], (erro2) => {
                if (erro2) return res.status(500).json({ erro: 'Mãe salva, erro nas crianças.' });
                console.log(`📝 Mãe e ${menores.length} criança(s) salvas com sucesso!`);
                res.status(201).json({ mensagem: 'Ficha completa salva com sucesso!' });
            });
        } else {
            console.log('📝 Apenas o responsável foi salvo (sem crianças).');
            res.status(201).json({ mensagem: 'Ficha do responsável salva.' });
        }
    });
});
// --- 5. ROTA PARA LISTAR AS FAMÍLIAS CADASTRADAS ---
app.get('/familias', (req, res) => {
    // Esse comando SQL junta a tabela de responsáveis com a de menores 
    // e conta quantos filhos cada mãe tem!
    const sql = `
        SELECT r.id, r.nome_mae, r.cpf, r.fones_contato, COUNT(m.id) AS total_filhos
        FROM responsaveis r
        LEFT JOIN menores m ON r.id = m.responsavel_id
        GROUP BY r.id
        ORDER BY r.nome_mae ASC;
    `;

    db.query(sql, (erro, resultados) => {
        if (erro) {
            console.error('Erro ao buscar as famílias:', erro);
            return res.status(500).json({ erro: 'Erro ao buscar dados no banco.' });
        }
        // Devolve a lista de famílias para o HTML
        res.status(200).json(resultados);
    });
});
// --- 6. ROTA PARA DELETAR FAMÍLIA (Com Auditoria!) ---
app.delete('/familias/:id', (req, res) => {
    const idDaMae = req.params.id;
    const autorDaAcao = req.query.autor; // Pega o nome do Admin que veio do HTML!

    // 1º Passo: Vamos descobrir o nome da mãe antes de apagar, para salvar no histórico
    db.query('SELECT nome_mae FROM responsaveis WHERE id = ?', [idDaMae], (erroBusca, resultBusca) => {
        if (erroBusca || resultBusca.length === 0) {
            return res.status(500).json({ erro: 'Família não encontrada.' });
        }
        
        const nomeMaeApagada = resultBusca[0].nome_mae;

        // 2º Passo: Deleta as crianças
        const sqlCriancas = 'DELETE FROM menores WHERE responsavel_id = ?';
        db.query(sqlCriancas, [idDaMae], (erro1) => {
            if (erro1) return res.status(500).json({ erro: 'Erro ao deletar crianças.' });

            // 3º Passo: Deleta a mãe
            const sqlMae = 'DELETE FROM responsaveis WHERE id = ?';
            db.query(sqlMae, [idDaMae], (erro2) => {
                if (erro2) return res.status(500).json({ erro: 'Erro ao deletar mãe.' });
                
                // 4º PASSO (A MÁGICA): Registra na Caixa Preta!
                const sqlLog = 'INSERT INTO logs_auditoria (usuario, acao, detalhes) VALUES (?, ?, ?)';
                const detalhes = `Excluiu a família da responsável: ${nomeMaeApagada}`;
                
                db.query(sqlLog, [autorDaAcao, 'EXCLUSÃO', detalhes], () => {
                    res.status(200).json({ mensagem: 'Família excluída e histórico salvo!' });
                });
            });
        });
    });
});
app.listen(3000, () => {
    console.log('🚀 Servidor rodando na porta 3000.');
});