const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
require('dotenv').config();
const { verificarToken, verificarAdmin } = require('./middleware/auth');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const app = express();

// ==========================================
// CONFIGURAÇÃO DO CORS (RESTRITO)
// ==========================================

//const corsOptions = {
//    origin: 'http://localhost:5500',   // <- ajuste se seu front-end usar outra porta
//    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//    allowedHeaders: ['Content-Type', 'Authorization']
//};
app.use(cors());

app.use('/img', express.static('img'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 1. CONEXÃO COM O BANCO DE DADOS ---
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

db.connect((erro) => {
    if (erro) console.error('Erro no MySQL:', erro);
    else console.log('✅ MySQL Conectado com sucesso!');
});

// ==========================================
// 🕵️ FUNÇÃO GLOBAL DE AUDITORIA
// ==========================================
function registrarLog(usuario, acao, detalhes) {
    const sql = "INSERT INTO logs_auditoria (usuario, acao, detalhes) VALUES (?, ?, ?)";
    db.query(sql, [usuario, acao, detalhes], (erro) => {
        if (erro) console.error("Falha ao gravar auditoria:", erro);
    });
}

// ==========================================
// UPLOAD SEGURO (APENAS IMAGENS, 2MB)
// ==========================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname))
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens JPG e PNG são permitidas.'));
        }
    }
});

// ==========================================
// ROTAS DA APLICAÇÃO
// ==========================================

// --- 2. ROTA: CADASTRAR VOLUNTÁRIO (VALIDADA) ---
app.post('/cadastrar-voluntario',
    verificarAdmin,
    [
        body('nome').notEmpty().withMessage('Nome é obrigatório.'),
        body('usuario').notEmpty().withMessage('Usuário é obrigatório.'),
        body('senha').isLength({ min: 6 }).withMessage('Senha deve ter no mínimo 6 caracteres.'),
        body('nivel_acesso').optional().isIn(['admin', 'voluntario']).withMessage('Nível inválido.')
    ],
    async (req, res) => {
        const erros = validationResult(req);
        if (!erros.isEmpty()) {
            return res.status(400).json({ erros: erros.array() });
        }

        const { nome, usuario, senha, nivel_acesso } = req.body;
        try {
            const senhaCriptografada = await bcrypt.hash(senha, 10);
            const sql = 'INSERT INTO voluntarios (nome, usuario, senha, nivel_acesso) VALUES (?, ?, ?, ?)';
            db.query(sql, [nome, usuario, senhaCriptografada, nivel_acesso || 'voluntario'], (erro) => {
                if (erro) return res.status(500).json({ erro: 'Erro ao cadastrar voluntário.' });
                
                registrarLog('Sistema Admin', 'CRIOU VOLUNTÁRIO', `Criou o acesso para: ${nome}`);
                res.status(201).json({ mensagem: 'Voluntário cadastrado com segurança!' });
            });
        } catch (erro) { res.status(500).json({ erro: 'Erro interno.' }); }
    }
);

// --- 3. ROTA DE LOGIN (VALIDADA) ---
app.post('/login',
    [
        body('usuario').notEmpty().withMessage('Usuário é obrigatório.'),
        body('senha').notEmpty().withMessage('Senha é obrigatória.')
    ],
    async (req, res, next) => {
        try {
            const erros = validationResult(req);
            if (!erros.isEmpty()) {
                return res.status(400).json({ erros: erros.array() });
            }

            const { usuario, senha } = req.body;
            const sql = 'SELECT * FROM voluntarios WHERE usuario = ?';
            db.query(sql, [usuario], async (erro, resultados) => {
                if (erro) return next(erro);
                if (resultados.length === 0) return res.status(401).json({ erro: 'Usuário não encontrado' });

                const voluntario = resultados[0];
                try {
                    const senhaCorreta = await bcrypt.compare(senha, voluntario.senha);
                    if (!senhaCorreta) return res.status(401).json({ erro: 'Senha incorreta' });

                    const token = jwt.sign(
                        { id: voluntario.id, nome: voluntario.nome, nivel: voluntario.nivel_acesso },
                        process.env.JWT_SECRET,
                        { expiresIn: '8h' }
                    );

                    res.status(200).json({
                        mensagem: 'Login aprovado!',
                        token: token,
                        nivel: voluntario.nivel_acesso,
                        nome: voluntario.nome,
                        id: voluntario.id
                    });
                } catch (err) {
                    next(err);
                }
            });
        } catch (err) {
            next(err);
        }
    }
);

// --- 4. LISTAR VOLUNTÁRIOS (Para Selects) ---
app.get('/voluntarios', verificarToken, (req, res) => {
    db.query('SELECT id, nome FROM voluntarios ORDER BY nome ASC', (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao buscar voluntários' });
        res.status(200).json(resultados);
    });
});

// --- 5. ROTA DE CADASTRO DE FAMÍLIAS (VALIDADA) ---
app.post('/cadastro',
    verificarToken,
    [
        body('responsavel.nome_mae').notEmpty().withMessage('Nome da mãe é obrigatório.'),
        body('responsavel.cpf').notEmpty().withMessage('CPF é obrigatório.'),
        body('responsavel.fones').notEmpty().withMessage('Telefone é obrigatório.'),
        body('menores').optional({ nullable: true }).isArray().withMessage('Lista de crianças deve ser um array.'),
        body('menores.*.nome').if(body('menores.*.nome').exists()).notEmpty().withMessage('Nome da criança é obrigatório.'),
        body('menores.*.sexo').if(body('menores.*.sexo').exists()).isIn(['M', 'F']).withMessage('Sexo deve ser M ou F.')
    ],
    (req, res, next) => {
        const erros = validationResult(req);
        if (!erros.isEmpty()) {
            return res.status(400).json({ erros: erros.array() });
        }

        const { responsavel, menores, voluntario_cadastro_id, voluntario_responsavel_id } = req.body;
        db.beginTransaction((erroTransacao) => {
            if (erroTransacao) return next(erroTransacao);

            const sqlMae = `
                INSERT INTO responsaveis 
                (nome_mae, rg, cpf, nis, titulo_eleitor, endereco, fones_contato, mae_trabalha, pai_trabalha, outra_ong, voluntario_cadastro_id, voluntario_responsavel_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const valoresMae = [
                responsavel.nome_mae, 
                responsavel.rg, 
                responsavel.cpf, 
                responsavel.nis, 
                responsavel.titulo_eleitor, 
                responsavel.endereco, 
                responsavel.fones, 
                responsavel.mae_trabalha, 
                responsavel.pai_trabalha, 
                responsavel.outra_ong, 
                voluntario_cadastro_id, 
                voluntario_responsavel_id
            ];

            db.query(sqlMae, valoresMae, (erroMae, resultadoMae) => {
                if (erroMae) {
                    return db.rollback(() => {
                        next(erroMae);
                    });
                }
                
                const responsavelId = resultadoMae.insertId;

                if (menores && menores.length > 0) {
                    const sqlCriancas = 'INSERT INTO menores (responsavel_id, nome_completo, data_nascimento, tamanho_roupa, tamanho_sapato, sexo) VALUES ?';
                    const valoresCriancas = menores.map(c => [responsavelId, c.nome, c.data, c.roupa, c.sapato, c.sexo]);
                    
                    db.query(sqlCriancas, [valoresCriancas], (erroCriancas) => {
                        if (erroCriancas) {
                            return db.rollback(() => {
                                next(erroCriancas);
                            });
                        }
                        db.commit((errCommit) => {
                            if (errCommit) {
                                return db.rollback(() => {
                                    next(errCommit);
                                });
                            }
                            registrarLog('Sistema', 'NOVO CADASTRO', `A família de ${responsavel.nome_mae} foi cadastrada.`);
                            res.status(201).json({ mensagem: 'Ficha completa salva!' });
                        });
                    });
                } else {
                    db.commit((errCommit) => {
                        if (errCommit) {
                            return db.rollback(() => {
                                next(errCommit);
                            });
                        }
                        registrarLog('Sistema', 'NOVO CADASTRO', `A família de ${responsavel.nome_mae} foi cadastrada.`);
                        res.status(201).json({ mensagem: 'Ficha salva!' });
                    });
                }
            });
        });
    }
);

// --- 6. ROTA PARA LISTAR AS FAMÍLIAS  ---
app.get('/familias', verificarToken, (req, res) => {
    let sql = `
        SELECT 
            r.id, r.nome_mae, r.cpf, r.fones_contato, r.voluntario_responsavel_id, r.status, r.validado,
            COUNT(m.id) AS total_filhos,
            SUM(CASE WHEN m.padrinho_id IS NOT NULL THEN 1 ELSE 0 END) AS apadrinhados,
            GROUP_CONCAT(m.nome_completo SEPARATOR ', ') AS nomes_criancas,
            GROUP_CONCAT(m.tamanho_roupa) AS lista_roupas,
            GROUP_CONCAT(m.tamanho_sapato) AS lista_sapatos,
            GROUP_CONCAT(m.sexo) AS lista_sexos
        FROM responsaveis r
        LEFT JOIN menores m ON r.id = m.responsavel_id
        GROUP BY r.id
        ORDER BY r.nome_mae ASC;
    `;

    db.query(sql, (erro, resultados) => {
        if (erro) {
            console.error("Erro no SQL de famílias:", erro);
            return res.status(500).json({ erro: 'Erro ao buscar dados.' });
        }
        res.status(200).json(resultados);
    });
});

// --- ROTA DE VALIDAÇÃO DE CPF EM TEMPO REAL ---
app.get('/verificar-cpf/:cpf', verificarToken, (req, res) => {
    const cpfDigitado = req.params.cpf;
    const sql = 'SELECT id FROM responsaveis WHERE cpf = ?';
    
    db.query(sql, [cpfDigitado], (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao verificar CPF' });
        
        if (resultados.length > 0) {
            res.status(200).json({ existe: true });
        } else {
            res.status(200).json({ existe: false });
        }
    });
});

// --- 7. BUSCAR FICHA COMPLETA DE UMA FAMÍLIA ---
app.get('/familias/:id', verificarToken, (req, res) => {
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

// --- ROTA: ADICIONAR NOVO FILHO A UMA FAMÍLIA EXISTENTE ---
app.post('/familias/:id/criancas', verificarToken, (req, res) => {
    const responsavelId = req.params.id;
    const { nome, data, roupa, sapato, sexo } = req.body;

    const sql = 'INSERT INTO menores (responsavel_id, nome_completo, data_nascimento, tamanho_roupa, tamanho_sapato, sexo) VALUES (?, ?, ?, ?, ?, ?)';
    
    db.query(sql, [responsavelId, nome, data, roupa, sapato, sexo], (erro) => {
        if (erro) {
            console.error('Erro ao adicionar criança:', erro);
            return res.status(500).json({ erro: 'Erro ao adicionar a criança.' });
        }
        registrarLog('Sistema', 'NOVO FILHO', `Registrou a criança ${nome} para a família ID ${responsavelId}`);
        res.status(201).json({ mensagem: 'Nova criança adicionada com sucesso!' });
    });
});

// --- 8. ARQUIVAR FAMÍLIA (SOFT DELETE) ---
app.delete('/familias/:id', verificarToken, (req, res) => {
    const id = req.params.id;
    const autor = req.query.autor || 'Usuário Desconhecido';

    const sql = "UPDATE responsaveis SET status = 'inativo' WHERE id = ?";
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ erro: 'Erro ao arquivar' });

        registrarLog(autor, 'ARQUIVAR FAMÍLIA', `A família ID ${id} foi movida para o arquivo morto.`);
        res.status(200).json({ mensagem: 'Arquivado com sucesso!' });
    });
});

// --- 9. ROTAS ADMIN ---
app.get('/admin/voluntarios', verificarAdmin, (req, res) => {
    db.query('SELECT id, nome, usuario, nivel_acesso FROM voluntarios ORDER BY nome ASC', (err, resu) => {
        if (err) return res.status(500).json({ erro: 'Erro ao buscar voluntários.' });
        res.status(200).json(resu);
    });
});

app.get('/admin/padrinhos', verificarAdmin, (req, res) => {
    db.query('SELECT * FROM padrinhos ORDER BY nome ASC', (err, resu) => {
        if (err) return res.status(500).json({ erro: 'Erro ao buscar padrinhos.' });
        res.status(200).json(resu);
    });
});

app.post('/admin/padrinhos',
    verificarAdmin,
    [
        body('nome').notEmpty().withMessage('Nome é obrigatório, a menos que seja doador anônimo.'),
        body('telefone').optional(),
        body('data_doacao').optional().isDate().withMessage('Data inválida.')
    ],
    (req, res, next) => {
        const erros = validationResult(req);
        if (!erros.isEmpty()) {
            return res.status(400).json({ erros: erros.array() });
        }

        let { nome, telefone, observacoes, eh_anonimo, data_doacao } = req.body;
        if (eh_anonimo) { nome = "Doador Anônimo"; telefone = telefone || "Não informado"; }
        const sql = 'INSERT INTO padrinhos (nome, telefone, observacoes, data_doacao) VALUES (?, ?, ?, ?)';
        db.query(sql, [nome, telefone, observacoes, data_doacao], (err, resu) => {
            if (err) return next(err);
            registrarLog('Sistema Admin', 'NOVO PADRINHO', `Cadastrou o doador: ${nome}`);
            res.status(201).json({ mensagem: 'Padrinho cadastrado!' });
        });
    }
);

// --- ROTA: EDITAR DADOS DE UM PADRINHO ---
app.put('/admin/padrinhos/:id', verificarAdmin, (req, res) => {
    let { nome, telefone, observacoes, eh_anonimo, data_doacao } = req.body;
    if (eh_anonimo) { nome = "Doador Anônimo"; telefone = telefone || "Não informado"; }
    const sql = 'UPDATE padrinhos SET nome = ?, telefone = ?, observacoes = ?, data_doacao = ? WHERE id = ?';
    db.query(sql, [nome, telefone, observacoes, data_doacao, req.params.id], (err) => {
        if (err) return res.status(500).json({ erro: 'Erro ao atualizar padrinho.' });
        res.status(200).json({ mensagem: 'Padrinho atualizado!' });
    });
});

app.delete('/admin/padrinhos/:id', verificarAdmin, (req, res) => {
    db.query('DELETE FROM padrinhos WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ erro: 'Erro ao excluir padrinho.' });
        registrarLog('Sistema Admin', 'EXCLUIR PADRINHO', `Deletou o padrinho ID ${req.params.id}`);
        res.status(200).json({ mensagem: 'Padrinho excluído.' });
    });
});

// --- ROTA: EDITAR DADOS DE UM VOLUNTÁRIO ---
app.put('/admin/voluntarios/:id', verificarAdmin, (req, res) => {
    const { nome, usuario, nivel_acesso } = req.body;
    const sql = 'UPDATE voluntarios SET nome = ?, usuario = ?, nivel_acesso = ? WHERE id = ?';
    db.query(sql, [nome, usuario, nivel_acesso, req.params.id], (err) => {
        if (err) return res.status(500).json({ erro: 'Erro ao atualizar voluntário.' });
        res.status(200).json({ mensagem: 'Voluntário atualizado!' });
    });
});

// --- ROTA: VINCULAR VOLUNTÁRIO (VERIFICA EXISTÊNCIA) ---
app.put('/admin/vincular-voluntario', verificarAdmin, (req, res) => {
    const { familia_id, voluntario_responsavel_id } = req.body;

    // Verifica se família existe
    db.query('SELECT id FROM responsaveis WHERE id = ?', [familia_id], (err, rowsFamilia) => {
        if (err) return res.status(500).json({ erro: 'Erro ao verificar família.' });
        if (rowsFamilia.length === 0) return res.status(404).json({ erro: 'Família não encontrada.' });

        // Se voluntario_responsavel_id for null, só desvincula
        if (voluntario_responsavel_id === null || voluntario_responsavel_id === undefined) {
            db.query('UPDATE responsaveis SET voluntario_responsavel_id = NULL WHERE id = ?', [familia_id], (erro) => {
                if (erro) return res.status(500).json({ erro: 'Erro ao desvincular.' });
                registrarLog('Sistema', 'VÍNCULO VOLUNTÁRIO', `Desvinculou voluntário da família ID ${familia_id}`);
                res.status(200).json({ mensagem: 'Voluntário desvinculado!' });
            });
            return;
        }

        // Verifica se o voluntário existe
        db.query('SELECT id FROM voluntarios WHERE id = ?', [voluntario_responsavel_id], (err, rowsVoluntario) => {
            if (err) return res.status(500).json({ erro: 'Erro ao verificar voluntário.' });
            if (rowsVoluntario.length === 0) return res.status(404).json({ erro: 'Voluntário não encontrado.' });

            // Ambos existem: atualiza
            db.query('UPDATE responsaveis SET voluntario_responsavel_id = ? WHERE id = ?', [voluntario_responsavel_id, familia_id], (erro) => {
                if (erro) return res.status(500).json({ erro: 'Erro ao vincular.' });
                registrarLog('Sistema', 'VÍNCULO VOLUNTÁRIO', `Vinculou voluntário ID ${voluntario_responsavel_id} à família ID ${familia_id}`);
                res.status(200).json({ mensagem: 'Voluntário vinculado!' });
            });
        });
    });
});

// --- ROTA: DELETAR VOLUNTÁRIO E DESVINCULAR FAMÍLIAS  ---
app.delete('/admin/voluntarios/:id', verificarAdmin, (req, res) => {
    const idVoluntario = req.params.id;

    // Passo 1: Desvincular como "Voluntário Acompanhante"
    db.query('UPDATE responsaveis SET voluntario_responsavel_id = NULL WHERE voluntario_responsavel_id = ?', [idVoluntario], (erro1) => {
        if (erro1) return res.status(500).json({ erro: 'Erro ao limpar responsável.' });

        // Passo 2: Desvincular como "Autor do Cadastro"
        db.query('UPDATE responsaveis SET voluntario_cadastro_id = NULL WHERE voluntario_cadastro_id = ?', [idVoluntario], (erro2) => {
            if (erro2) return res.status(500).json({ erro: 'Erro ao limpar autor do cadastro.' });

            // Passo 3: Deletar o voluntário
            db.query('DELETE FROM voluntarios WHERE id = ?', [idVoluntario], (erro3) => {
                if (erro3) {
                    console.error('❌ Erro ao deletar voluntário:', erro3);
                    return res.status(500).json({ erro: 'Erro ao excluir o voluntário do banco.' });
                }
                registrarLog('Sistema Admin', 'EXCLUIR VOLUNTÁRIO', `Deletou o usuário ID ${idVoluntario}`);
                res.status(200).json({ mensagem: 'Voluntário excluído e famílias desvinculadas com sucesso!' });
            });
        });
    });
});

// --- 10. ROTA DE VÍNCULO (MATCH) PADRINHO E CRIANÇA (VERIFICA EXISTÊNCIA) ---
app.put('/vincular-padrinho', verificarToken, (req, res) => {
    const { crianca_id, padrinho_id } = req.body;

    // Verifica se a criança existe
    db.query('SELECT id FROM menores WHERE id = ?', [crianca_id], (err, rowsCrianca) => {
        if (err) return res.status(500).json({ erro: 'Erro ao verificar criança.' });
        if (rowsCrianca.length === 0) return res.status(404).json({ erro: 'Criança não encontrada.' });

        // Se padrinho_id for null, desvincula
        if (padrinho_id === null || padrinho_id === undefined) {
            db.query('UPDATE menores SET padrinho_id = NULL WHERE id = ?', [crianca_id], (erro) => {
                if (erro) return res.status(500).json({ erro: 'Erro ao desvincular.' });
                registrarLog('Sistema', 'VÍNCULO PADRINHO', `Removeu padrinho da criança ID ${crianca_id}`);
                res.status(200).json({ mensagem: 'Padrinho removido!' });
            });
            return;
        }

        // Verifica se o padrinho existe
        db.query('SELECT id FROM padrinhos WHERE id = ?', [padrinho_id], (err, rowsPadrinho) => {
            if (err) return res.status(500).json({ erro: 'Erro ao verificar padrinho.' });
            if (rowsPadrinho.length === 0) return res.status(404).json({ erro: 'Padrinho não encontrado.' });

            db.query('UPDATE menores SET padrinho_id = ? WHERE id = ?', [padrinho_id, crianca_id], (erro) => {
                if (erro) return res.status(500).json({ erro: 'Erro ao vincular.' });
                registrarLog('Sistema', 'VÍNCULO PADRINHO', `Vinculou padrinho ID ${padrinho_id} à criança ID ${crianca_id}`);
                res.status(200).json({ mensagem: 'Vínculo salvo!' });
            });
        });
    });
});

// --- 11. ROTA PARA EDITAR DADOS (VALIDADA E COM VERIFICAÇÃO DE CPF DUPLICADO) ---
app.put('/familias/:id',
    verificarToken,
    [
        body('nome_mae').notEmpty().withMessage('Nome da mãe é obrigatório.'),
        body('cpf').notEmpty().withMessage('CPF é obrigatório.'),
        body('fones_contato').notEmpty().withMessage('Telefone é obrigatório.')
    ],
    (req, res) => {
        const erros = validationResult(req);
        if (!erros.isEmpty()) {
            return res.status(400).json({ erros: erros.array() });
        }

        const id = req.params.id;
        const { nome_mae, cpf, nis, fones_contato, endereco, titulo_eleitor, mae_trabalha, pai_trabalha, outra_ong } = req.body;

        // Verifica se o CPF já existe em outra família
        db.query('SELECT id FROM responsaveis WHERE cpf = ? AND id != ?', [cpf, id], (erroCPF, rowsCPF) => {
            if (erroCPF) return res.status(500).json({ erro: 'Erro ao verificar CPF.' });
            if (rowsCPF.length > 0) {
                return res.status(400).json({ erro: 'CPF já cadastrado para outra família.' });
            }

            const sql = `
                UPDATE responsaveis 
                SET nome_mae = ?, cpf = ?, nis = ?, fones_contato = ?, endereco = ?, titulo_eleitor = ?, mae_trabalha = ?, pai_trabalha = ?, outra_ong = ? 
                WHERE id = ?
            `;
            
            const valoresEdicao = [nome_mae, cpf, nis, fones_contato, endereco, titulo_eleitor, mae_trabalha, pai_trabalha, outra_ong, id];

            db.query(sql, valoresEdicao, (erro, resultado) => {
                if (erro) {
                    console.error('❌ ERRO NO BANCO:', erro);
                    return res.status(500).json({ erro: 'Erro ao atualizar dados.' });
                }
                registrarLog('Sistema', 'EDIÇÃO DE FICHA', `A ficha da mãe ${nome_mae} foi atualizada.`);
                res.status(200).json({ mensagem: 'Dados atualizados com sucesso!' });
            });
        });
    }
);

// --- 12. ROTA DE EVENTOS E ENTREGAS ---
app.get('/eventos', verificarToken, (req, res) => {
    db.query("SELECT * FROM eventos WHERE status = 'ativo' ORDER BY id DESC", (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao buscar eventos.' });
        res.status(200).json(resultados);
    });
});

app.get('/admin/eventos-arquivados', verificarAdmin, (req, res) => {
    db.query("SELECT * FROM eventos WHERE status = 'inativo' ORDER BY id DESC", (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao buscar eventos arquivados.' });
        res.status(200).json(resultados);
    });
});

app.put('/admin/eventos/:id/arquivar', verificarAdmin, (req, res) => {
    db.query("UPDATE eventos SET status = 'inativo' WHERE id = ?", [req.params.id], (erro) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao arquivar evento.' });
        registrarLog('Sistema Admin', 'ARQUIVOU CAMPANHA', `A campanha ID ${req.params.id} foi arquivada.`);
        res.status(200).json({ mensagem: 'Evento movido para a lixeira!' });
    });
});

app.put('/admin/eventos/:id/restaurar', verificarAdmin, (req, res) => {
    db.query("UPDATE eventos SET status = 'ativo' WHERE id = ?", [req.params.id], (erro) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao restaurar evento.' });
        registrarLog('Sistema Admin', 'RESTAUROU CAMPANHA', `A campanha ID ${req.params.id} foi ativada novamente.`);
        res.status(200).json({ mensagem: 'Evento restaurado com sucesso!' });
    });
});

app.delete('/admin/eventos/:id/excluir-definitivo', verificarAdmin, (req, res) => {
    db.query('DELETE FROM eventos WHERE id = ?', [req.params.id], (erro) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao excluir definitivamente.' });
        registrarLog('Sistema Admin', 'EXCLUIU CAMPANHA', `Deletou permanentemente a campanha ID ${req.params.id}`);
        res.status(200).json({ mensagem: 'Evento apagado para sempre!' });
    });
});

app.post('/admin/eventos',
    verificarAdmin,
    [
        body('nome').notEmpty().withMessage('Nome do evento é obrigatório.'),
        body('data_evento').isDate().withMessage('Data inválida.')
    ],
    (req, res) => {
        const erros = validationResult(req);
        if (!erros.isEmpty()) {
            return res.status(400).json({ erros: erros.array() });
        }

        const { nome, data_evento } = req.body;
        db.query('INSERT INTO eventos (nome, data_evento) VALUES (?, ?)', [nome, data_evento], (erro) => {
            if (erro) return res.status(500).json({ erro: 'Erro ao criar evento.' });
            registrarLog('Admin', 'NOVA CAMPANHA', `Criou o evento de entrega: ${nome}`);
            res.status(201).json({ mensagem: 'Evento criado com sucesso!' });
        });
    }
);

app.post('/entregas',
    verificarToken,
    [
        body('evento_id').isInt().withMessage('ID do evento inválido.'),
        body('familia_id').isInt().withMessage('ID da família inválido.')
    ],
    (req, res) => {
        const erros = validationResult(req);
        if (!erros.isEmpty()) {
            return res.status(400).json({ erros: erros.array() });
        }

        const { evento_id, familia_id } = req.body;
        db.query('INSERT INTO entregas (evento_id, familia_id) VALUES (?, ?)', [evento_id, familia_id], (erro) => {
            if (erro) return res.status(500).json({ erro: 'Erro ao registrar entrega.' });
            registrarLog('Sistema', 'BAIXA DE DOAÇÃO', `Registrou a entrega para a família ID ${familia_id} no evento ID ${evento_id}`);
            res.status(201).json({ mensagem: 'Entrega registrada na ficha da família!' });
        });
    }
);

app.get('/eventos/:id/entregas', verificarToken, (req, res) => {
    db.query('SELECT familia_id FROM entregas WHERE evento_id = ?', [req.params.id], (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao buscar entregas.' });
        const familiasEntregues = resultados.map(r => r.familia_id);
        res.status(200).json(familiasEntregues);
    });
});

app.put('/admin/eventos/:id', verificarAdmin, (req, res) => {
    const { nome, data_evento } = req.body;
    db.query('UPDATE eventos SET nome = ?, data_evento = ? WHERE id = ?', [nome, data_evento, req.params.id], (erro) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao atualizar evento.' });
        res.status(200).json({ mensagem: 'Evento atualizado com sucesso!' });
    });
});

// --- 13. ROTAS DE VALIDAÇÃO E RESTAURAÇÃO ---
app.put('/admin/familias/:id/validar', verificarAdmin, (req, res) => {
    const sql = 'UPDATE responsaveis SET validado = 1 - validado WHERE id = ?';
    db.query(sql, [req.params.id], (erro) => {
        if (erro) {
            console.error("Erro ao validar:", erro);
            return res.status(500).json({ erro: 'Erro ao alterar status' });
        }
        registrarLog('Sistema Admin', 'VALIDAÇÃO', `Alterou o status de validação da família ID ${req.params.id}`);
        res.status(200).json({ mensagem: 'Status de validação alterado!' });
    });
});

app.get('/admin/arquivadas', verificarAdmin, (req, res) => {
    db.query("SELECT id, nome_mae, cpf FROM responsaveis WHERE status = 'inativo' ORDER BY nome_mae ASC", (erro, resultados) => {
        res.status(200).json(resultados);
    });
});

app.put('/admin/familias/:id/restaurar', verificarAdmin, (req, res) => {
    db.query("UPDATE responsaveis SET status = 'ativo' WHERE id = ?", [req.params.id], () => {
        registrarLog('Sistema Admin', 'RESTAURAR FAMÍLIA', `A família ID ${req.params.id} foi resgatada do arquivo morto.`);
        res.status(200).json({ mensagem: 'Família restaurada!' });
    });
});

// --- ATUALIZAR TAMANHO DE ROUPA E SAPATO DA CRIANÇA ---
app.put('/menores/:id/tamanhos', verificarToken, (req, res) => {
    const id = req.params.id;
    const { tamanho_roupa, tamanho_sapato } = req.body;
    const sql = 'UPDATE menores SET tamanho_roupa = ?, tamanho_sapato = ? WHERE id = ?';
    
    db.query(sql, [tamanho_roupa, tamanho_sapato, id], (err) => {
        if(err) return res.status(500).json({ erro: 'Erro ao atualizar.' });
        res.status(200).json({ msg: 'Criança atualizada!' });
    });
});

// --- ROTAS PARA ATUALIZAR FOTOS PELA TELA (somente caminho local) ---
app.put('/familias/:id/foto', verificarToken, (req, res) => {
    const idFamilia = req.params.id;
    const novaFoto = req.body.foto_url;

    // Validação simples: só aceita caminhos que parecem locais ou URLs seguras (aqui preferimos apenas nomes de arquivo)
    if (!novaFoto || typeof novaFoto !== 'string' || novaFoto.includes('..')) {
        return res.status(400).json({ erro: 'URL de foto inválida.' });
    }

    db.query('UPDATE responsaveis SET foto_url = ? WHERE id = ?', [novaFoto, idFamilia], (err, resultado) => {
        if (err) return res.status(500).json({ erro: 'Erro ao salvar foto da mãe.' });
        res.status(200).json({ mensagem: 'Foto atualizada com sucesso!' });
    });
});
    
app.put('/menores/:id/foto', verificarToken, (req, res) => {
    const idCrianca = req.params.id;
    const novaFoto = req.body.foto_url;

    if (!novaFoto || typeof novaFoto !== 'string' || novaFoto.includes('..')) {
        return res.status(400).json({ erro: 'URL de foto inválida.' });
    }

    db.query('UPDATE menores SET foto_url = ? WHERE id = ?', [novaFoto, idCrianca], (err, resultado) => {
        if (err) return res.status(500).json({ erro: 'Erro ao salvar foto da criança.' });
        res.status(200).json({ mensagem: 'Foto atualizada com sucesso!' });
    });
});

// =========================================================
// --- ROTAS DE UPLOAD DE FOTOS (USANDO MULTER SEGURO) ---
// =========================================================
app.post('/familias/:id/upload-foto', verificarToken, upload.single('foto'), (req, res, next) => {
    if (!req.file) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });
    const caminhoDaFoto = 'uploads/' + req.file.filename; 
    db.query('UPDATE responsaveis SET foto_url = ? WHERE id = ?', [caminhoDaFoto, req.params.id], (err) => {
        if (err) return next(err);
        res.status(200).json({ mensagem: 'Upload feito com sucesso!', foto_url: caminhoDaFoto });
    });
});

app.post('/menores/:id/upload-foto', verificarToken, upload.single('foto'), (req, res, next) => {
    if (!req.file) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });
    const caminhoDaFoto = 'uploads/' + req.file.filename; 
    db.query('UPDATE menores SET foto_url = ? WHERE id = ?', [caminhoDaFoto, req.params.id], (err) => {
        if (err) return next(err);
        res.status(200).json({ mensagem: 'Upload feito com sucesso!', foto_url: caminhoDaFoto });
    });
});

// =========================================================
// --- ROTAS DA GALERIA DE FOTOS DOS EVENTOS ---
// =========================================================
app.post('/admin/eventos/:id/fotos', verificarAdmin, upload.single('foto'), (req, res, next) => {
    if (!req.file) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });
    const caminhoDaFoto = 'uploads/' + req.file.filename;
    db.query('INSERT INTO fotos_evento (evento_id, foto_url) VALUES (?, ?)', [req.params.id, caminhoDaFoto], (erro) => {
        if (erro) return next(erro);
        res.status(201).json({ mensagem: 'Foto adicionada à galeria!', foto_url: caminhoDaFoto });
    });
});

app.get('/admin/eventos/:id/fotos', verificarAdmin, (req, res) => {
    db.query('SELECT * FROM fotos_evento WHERE evento_id = ? ORDER BY id DESC', [req.params.id], (erro, resultados) => {
        if (erro) return res.status(500).json({ erro: 'Erro ao buscar galeria.' });
        res.status(200).json(resultados);
    });
});

// =======================================================
// ROTA DE AUDITORIA (LOGS)
// =======================================================
app.get('/admin/logs', verificarAdmin, (req, res) => {
    const sql = "SELECT * FROM logs_auditoria ORDER BY data_hora DESC LIMIT 100";
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Erro ao buscar logs:', err);
            return res.status(500).json({ erro: 'Erro ao buscar logs' });
        }
        res.status(200).json(results);
    });
});

// =======================================================
// MIDDLEWARE GLOBAL DE ERROS (TRATAMENTO FINAL)
// =======================================================
app.use((err, req, res, next) => {
    console.error('💥 Erro interno:', err);

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ erro: 'Arquivo muito grande. Máximo 2MB.' });
        }
        return res.status(400).json({ erro: 'Erro no upload: ' + err.message });
    }

    if (err.message && err.message.includes('Apenas imagens')) {
        return res.status(400).json({ erro: err.message });
    }

    // Erros inesperados
    res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// =======================================================
// INICIAR SERVIDOR
// =======================================================
app.listen(3000, () => {
    console.log('🚀 Servidor da ONG NAIRE rodando liso na porta 3000.');
});