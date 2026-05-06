const jwt = require('jsonwebtoken');

// Middleware que verifica se o token é válido
function verificarToken(req, res, next) {
    // O token vem no cabeçalho Authorization como "Bearer <token>"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // separa "Bearer" do token

    if (!token) {
        return res.status(401).json({ erro: 'Acesso negado. Token não fornecido.' });
    }

    try {
        // Verifica a assinatura do token usando a chave secreta do .env
        const decodificado = jwt.verify(token, process.env.JWT_SECRET);
        // Injeta os dados do usuário na requisição para uso posterior
        req.usuario = decodificado; // terá { id, nome, nivel }
        next(); // prossegue para a rota
    } catch (err) {
        return res.status(403).json({ erro: 'Token inválido ou expirado.' });
    }
}

// Middleware que exige nível admin (deve ser usado DEPOIS do verificarToken)
function verificarAdmin(req, res, next) {
    // Primeiro chama o middleware de token
    verificarToken(req, res, () => {
        // Se chegou aqui, o token é válido e req.usuario existe
        if (req.usuario.nivel === 'admin') {
            next(); // admin, pode continuar
        } else {
            return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
        }
    });
}

module.exports = { verificarToken, verificarAdmin };