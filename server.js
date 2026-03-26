const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');

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

// --- 2. ROTA: CADASTRAR VOLUNTÁRIO ---
app.post('/cadastrar-voluntario', async (req, res) => {
    const { nome, usuario, senha, nivel_acesso } = req.body;
    try {
        const senhaCriptografada = await bcrypt.hash(senha, 10);
        const sql = 'INSERT INTO voluntarios (nome, usuario, senha, nivel_acesso) VALUES (?, ?, ?, ?)';
        db.query(sql, [nome, usuario, senhaCriptografada, nivel_acesso || 'voluntario'], (erro) => {
            if (erro) return res.status(500).json({ erro: 'Erro ao cadastrar voluntário.' });
            res.status(201).json({ mensagem: 'Voluntário cadastrado com segurança!' });
        });
    } catch (erro) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// --- 3. ROTA DE LOGIN ---
app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    const sql = 'SELECT * FROM voluntarios WHERE usuario = ?';
    db.query(sql, [usuario], async (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro no banco.' });
        if (resultados.length === 0) return res.status(401).json({ erro: 'Usuário não encontrado' });

        const voluntario = resultados[0];
        const senhaCorreta = await bcrypt.compare(senha, voluntario.senha);

        if (senhaCorreta) {
            res.status(200).json({ 
                mensagem: 'Login aprovado!', 
                nivel: voluntario.nivel_acesso,
                nome: voluntario.nome,
                id: voluntario.id 
            });
        } else { res.status(401).json({ erro: 'Senha incorreta' }); }
    });
});

// --- 4. LISTAR VOLUNTÁRIOS (Para Selects) ---
app.get('/voluntarios', (req, res) => {
    db.query('SELECT id, nome FROM voluntarios ORDER BY nome ASC', (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao buscar voluntários' });
        res.status(200).json(resultados);
    });
});

// --- 5. ROTA DE CADASTRO DE FAMÍLIAS (Com Transações) ---
app.post('/cadastro', (req, res) => {
    const { responsavel, menores, voluntario_cadastro_id, voluntario_responsavel_id } = req.body;
    db.beginTransaction((erroTransacao) => {
        if (erroTransacao) return res.status(500).json({ erro: 'Erro na transação.' });

        const sqlMae = 'INSERT INTO responsaveis (nome_mae, rg, cpf, endereco, fones_contato, voluntario_cadastro_id, voluntario_responsavel_id) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const valoresMae = [responsavel.nome_mae, responsavel.rg, responsavel.cpf, responsavel.endereco, responsavel.fones, voluntario_cadastro_id, voluntario_responsavel_id];

        db.query(sqlMae, valoresMae, (erroMae, resultadoMae) => {
            if (erroMae) return db.rollback(() => res.status(500).json({ erro: 'Erro ao salvar mãe.' }));
            const responsavelId = resultadoMae.insertId;

            if (menores && menores.length > 0) {
                const sqlCriancas = 'INSERT INTO menores (responsavel_id, nome_completo, data_nascimento, tamanho_roupa, tamanho_sapato) VALUES ?';
                const valoresCriancas = menores.map(c => [responsavelId, c.nome, c.data, c.roupa, c.sapato]);
                db.query(sqlCriancas, [valoresCriancas], (erroCriancas) => {
                    if (erroCriancas) return db.rollback(() => res.status(500).json({ erro: 'Erro nas crianças.' }));
                    db.commit((err) => res.status(201).json({ mensagem: 'Ficha completa salva!' }));
                });
            } else {
                db.commit((err) => res.status(201).json({ mensagem: 'Ficha salva!' }));
            }
        });
    });
});

// --- 6. ROTA PARA LISTAR AS FAMÍLIAS (VERSÃO BLINDADA) ---
app.get('/familias', (req, res) => {
    const voluntarioId = req.query.voluntario_id;
    let sql = `
        SELECT 
            r.id, r.nome_mae, r.cpf, r.fones_contato, r.voluntario_responsavel_id,
            (SELECT COUNT(*) FROM menores WHERE responsavel_id = r.id) AS total_filhos,
            (SELECT COUNT(*) FROM menores WHERE responsavel_id = r.id AND padrinho_id IS NOT NULL) AS apadrinhados
        FROM responsaveis r
    `;
    const valores = [];
    if (voluntarioId) {
        sql += ` WHERE r.voluntario_responsavel_id = ? `;
        valores.push(voluntarioId);
    }
    sql += ` ORDER BY r.nome_mae ASC;`;

    db.query(sql, valores, (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao buscar dados.' });
        res.status(200).json(resultados);
    });
});

// --- 7. BUSCAR FICHA COMPLETA DE UMA FAMÍLIA ---
app.get('/familias/:id', (req, res) => {
    const idDaFamilia = req.params.id;
    const sqlMae = `
        SELECT r.*, v.nome AS nome_voluntario_responsavel
        FROM responsaveis r
        LEFT JOIN voluntarios v ON r.voluntario_responsavel_id = v.id
        WHERE r.id = ?
    `;
    db.query(sqlMae, [idDaFamilia], (erroMae, resultadoMae) => {
        if (erroMae || resultadoMae.length === 0) return res.status(404).json({ erro: 'Não encontrado.' });
        const sqlCriancas = `
            SELECT c.*, p.nome AS nome_padrinho
            FROM menores c
            LEFT JOIN padrinhos p ON c.padrinho_id = p.id
            WHERE c.responsavel_id = ?
        `;
        db.query(sqlCriancas, [idDaFamilia], (erroCriancas, resultadoCriancas) => {
            res.status(200).json({ responsavel: resultadoMae[0], menores: resultadoCriancas });
        });
    });
});

// --- 8. DELETAR FAMÍLIA ---
app.delete('/familias/:id', (req, res) => {
    const idDaMae = req.params.id;
    const autorDaAcao = req.query.autor;
    db.query('DELETE FROM menores WHERE responsavel_id = ?', [idDaMae], () => {
        db.query('DELETE FROM responsaveis WHERE id = ?', [idDaMae], () => {
            res.status(200).json({ mensagem: 'Excluído com sucesso!' });
        });
    });
});

// --- 9. ROTAS ADMIN: VOLUNTÁRIOS E PADRINHOS ---
app.get('/admin/voluntarios', (req, res) => {
    db.query('SELECT id, nome, usuario, nivel_acesso FROM voluntarios ORDER BY nome ASC', (err, resu) => {
        res.status(200).json(resu);
    });
});

app.get('/admin/padrinhos', (req, res) => {
    db.query('SELECT * FROM padrinhos ORDER BY nome ASC', (err, resu) => {
        res.status(200).json(resu);
    });
});

app.post('/admin/padrinhos', (req, res) => {
    let { nome, telefone, observacoes, eh_anonimo, data_doacao } = req.body;
    if (eh_anonimo) { nome = "Doador Anônimo"; telefone = telefone || "Não informado"; }
    const sql = 'INSERT INTO padrinhos (nome, telefone, observacoes, data_doacao) VALUES (?, ?, ?, ?)';
    db.query(sql, [nome, telefone, observacoes, data_doacao], (err, resu) => {
        res.status(201).json({ mensagem: 'Padrinho cadastrado!' });
    });
});

app.delete('/admin/padrinhos/:id', (req, res) => {
    db.query('DELETE FROM padrinhos WHERE id = ?', [req.params.id], () => {
        res.status(200).json({ mensagem: 'Padrinho excluído.' });
    });
});

app.put('/admin/vincular-voluntario', (req, res) => {
    const { familia_id, voluntario_responsavel_id } = req.body;
    db.query('UPDATE responsaveis SET voluntario_responsavel_id = ? WHERE id = ?', [voluntario_responsavel_id, familia_id], () => {
        res.status(200).json({ mensagem: 'Voluntário vinculado!' });
    });
});

// --- 10. ROTA DE VÍNCULO (MATCH) PADRINHO E CRIANÇA ---
app.put('/vincular-padrinho', (req, res) => {
    const { crianca_id, padrinho_id } = req.body;
    console.log(`\n🕵️‍♂️ TESTE DE VÍNCULO: ID Criança: ${crianca_id} | ID Padrinho: ${padrinho_id}`);
    const sql = 'UPDATE menores SET padrinho_id = ? WHERE id = ?';
    db.query(sql, [padrinho_id || null, crianca_id], (erro, resultado) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao vincular.' });
        console.log(`✅ Sucesso! Linhas alteradas: ${resultado.affectedRows}\n`);
        res.status(200).json({ mensagem: 'Vínculo salvo!' });
    });
});
// --- 11. ROTA PARA EDITAR DADOS DA MÃE ---
app.put('/familias/:id', (req, res) => {
    const id = req.params.id;
    const { nome_mae, cpf, fones_contato, endereco } = req.body;
    
    const sql = 'UPDATE responsaveis SET nome_mae = ?, cpf = ?, fones_contato = ?, endereco = ? WHERE id = ?';
    db.query(sql, [nome_mae, cpf, fones_contato, endereco, id], (erro, resultado) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao atualizar dados.' });
        res.status(200).json({ mensagem: 'Dados atualizados com sucesso!' });
    });
});
app.listen(3000, () => {
    console.log('🚀 Servidor rodando na porta 3000.');
});
