const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Evita que erros não tratados derrubem o servidor (comum no Windows devido a EBUSY/arquivos travados)
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection detectado (ignorado para evitar queda):', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception detectado (ignorado para evitar queda):', error);
});

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Estado da conexão do WhatsApp
let clientStatus = 'DISCONNECTED'; // DISCONNECTED, INITIALIZING, QR_READY, CONNECTING, CONNECTED
let lastQr = null;
let client = null;

// Função para criar e configurar o cliente WhatsApp
function createWhatsAppClient() {
    console.log('Configurando nova instância do WhatsApp Client...');
    clientStatus = 'INITIALIZING';
    io.emit('status', { status: clientStatus });

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
            ]
        }
    });

    // Eventos do WhatsApp
    client.on('qr', (qr) => {
        clientStatus = 'QR_READY';
        qrcode.toDataURL(qr, (err, url) => {
            if (!err) {
                lastQr = url;
                io.emit('status', { status: clientStatus, qr: url });
            }
        });
    });

    client.on('ready', () => {
        clientStatus = 'CONNECTED';
        lastQr = null;
        io.emit('status', { status: clientStatus });
        console.log('WhatsApp Client pronto e conectado!');
    });

    client.on('authenticated', () => {
        clientStatus = 'CONNECTING';
        io.emit('status', { status: clientStatus });
        console.log('WhatsApp Client autenticado!');
    });

    client.on('auth_failure', (msg) => {
        clientStatus = 'DISCONNECTED';
        lastQr = null;
        io.emit('status', { status: clientStatus, message: 'Falha na autenticação: ' + msg });
        console.error('Falha de autenticação do WhatsApp:', msg);
    });

    client.on('disconnected', async (reason) => {
        console.log('WhatsApp desconectado:', reason);
        clientStatus = 'DISCONNECTED';
        lastQr = null;
        io.emit('status', { status: clientStatus, message: 'Desconectado: ' + reason });
        
        // Destrói o cliente e recria após desconexão
        try {
            await client.destroy();
        } catch (e) {
            console.error('Erro ao destruir cliente após desconexão:', e);
        }

        // Aguarda 3 segundos para liberar os arquivos e tenta limpar a pasta
        setTimeout(() => {
            cleanSessionDirectory();
            createWhatsAppClient();
        }, 3000);
    });

    client.initialize().catch(err => {
        clientStatus = 'DISCONNECTED';
        const errMsg = 'Erro ao inicializar o navegador: ' + (err.message || err);
        io.emit('status', { status: clientStatus, message: errMsg });
        console.error('Erro na inicialização do cliente WhatsApp:', err);
    });
}

// Limpa a pasta do cache/sessão com segurança
function cleanSessionDirectory() {
    const authPath = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(authPath)) {
        try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log('Pasta de sessão anterior removida com sucesso.');
        } catch (rmErr) {
            console.error('Aviso: Não foi possível remover todos os arquivos de sessão (estão em uso ou bloqueados pelo Windows).');
        }
    }
}

// Recria o cliente WhatsApp de forma segura em caso de falha crítica do Puppeteer
async function recreateWhatsAppClientGracefully() {
    console.log('Reiniciando WhatsApp Client por instabilidade no navegador (Graceful Reset)...');
    clientStatus = 'DISCONNECTED';
    io.emit('status', { status: clientStatus, message: 'Reiniciando por instabilidade...' });
    
    if (client) {
        try {
            await client.destroy();
        } catch (destErr) {
            console.error('Erro ao destruir cliente no reset graceful:', destErr);
        }
        
        // Garante que o processo do Puppeteer seja finalizado (importante no Windows)
        try {
            if (client.pupBrowser) {
                const proc = client.pupBrowser.process();
                if (proc && !proc.killed) {
                    console.log('Forçando encerramento do processo Puppeteer...');
                    proc.kill('SIGKILL');
                }
            }
        } catch (killErr) {
            console.error('Erro ao forçar encerramento do processo do navegador:', killErr);
        }
    }
    
    // Aguarda 2.5 segundos para o Windows liberar os arquivos bloqueados antes de recriar
    setTimeout(() => {
        createWhatsAppClient();
    }, 2500);
}

// Inicializa a primeira vez
createWhatsAppClient();

// Estado de Validação
let validationState = {
    active: false,
    paused: false,
    list: [],
    currentIndex: 0,
    results: [],
    delay: 1200 // default 1.2s
};

// Limpa formatação do número
function sanitizeNumber(numStr) {
    let clean = numStr.replace(/\D/g, '');
    if (clean.length === 10 || clean.length === 11) {
        clean = '55' + clean;
    }
    return clean;
}

// Loop de validação assíncrona
async function runValidationLoop() {
    while (validationState.active && validationState.currentIndex < validationState.list.length) {
        if (validationState.paused) {
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
        }

        const rawNumber = validationState.list[validationState.currentIndex];
        const sanitized = sanitizeNumber(rawNumber);
        
        let result = {
            raw: rawNumber,
            sanitized: sanitized,
            isValid: false,
            formatted: null,
            profilePic: null,
            error: null
        };

        if (clientStatus !== 'CONNECTED') {
            result.error = 'WhatsApp desconectado durante a validação';
            validationState.results.push(result);
            io.emit('validation-item', { index: validationState.currentIndex, result });
            validationState.currentIndex++;
            continue;
        }

        if (!sanitized || sanitized.length < 8) {
            result.error = 'Número inválido ou muito curto';
            validationState.results.push(result);
            io.emit('validation-item', { index: validationState.currentIndex, result });
            validationState.currentIndex++;
            continue;
        }

        try {
            const numberId = await client.getNumberId(sanitized);
            
            if (numberId) {
                result.isValid = true;
                result.formatted = numberId._serialized;
                
                try {
                    result.profilePic = await client.getProfilePicUrl(numberId._serialized);
                } catch (picErr) {
                    // Ignora erro ao buscar foto de perfil
                }
            } else {
                result.isValid = false;
            }
        } catch (err) {
            const errMsg = err.message || '';
            result.error = errMsg || 'Erro ao validar';
            
            // Detect detached frame, context destroyed, protocol errors, or session closed
            if (errMsg.includes('detached Frame') || 
                errMsg.includes('Protocol error') || 
                errMsg.includes('Session closed') || 
                errMsg.includes('Execution context was destroyed') ||
                errMsg.includes('evaluate')) {
                
                console.error('Erro crítico do Puppeteer detectado na validação:', errMsg);
                
                // Pausar validação no backend
                validationState.paused = true;
                
                // Notificar frontend que a validação foi pausada devido a instabilidade e enviar alerta
                io.emit('validation-paused', { message: 'Instabilidade detectada no navegador WhatsApp. Validação pausada.' });
                io.emit('error-msg', 'O navegador do WhatsApp perdeu a conexão. Tentando restabelecer...');
                
                // Recriar o cliente de forma assíncrona/segura
                recreateWhatsAppClientGracefully();
            }
        }

        validationState.results.push(result);
        io.emit('validation-item', { index: validationState.currentIndex, result });
        
        validationState.currentIndex++;

        // Aguarda o delay com uma variação aleatória de -30% a +40% para simular comportamento humano e evitar banimento
        if (validationState.currentIndex < validationState.list.length && validationState.active && !validationState.paused) {
            const baseDelay = validationState.delay;
            const randomFactor = 0.7 + Math.random() * 0.7; // Ex: de 0.7x a 1.4x o delay base
            const finalDelay = Math.round(baseDelay * randomFactor);
            await new Promise(resolve => setTimeout(resolve, finalDelay));
        }
    }

    if (validationState.currentIndex >= validationState.list.length) {
        validationState.active = false;
        io.emit('validation-complete', { results: validationState.results });
    }
}

// Conexão Socket.io
io.on('connection', (socket) => {
    console.log('Cliente conectado ao Socket.io:', socket.id);

    // Envia status atual ao se conectar
    socket.emit('status', { status: clientStatus, qr: lastQr });

    // Se estiver ocorrendo uma validação, envia o progresso atual
    if (validationState.active || validationState.results.length > 0) {
        socket.emit('validation-status', {
            active: validationState.active,
            paused: validationState.paused,
            currentIndex: validationState.currentIndex,
            total: validationState.list.length,
            results: validationState.results
        });
    }

    // Iniciar validação
    socket.on('start-validation', (data) => {
        if (clientStatus !== 'CONNECTED') {
            socket.emit('error-msg', 'O WhatsApp precisa estar conectado para validar números.');
            return;
        }

        if (validationState.active) {
            socket.emit('error-msg', 'Já existe uma validação em andamento.');
            return;
        }

        const { numbers, delay } = data;
        if (!Array.isArray(numbers) || numbers.length === 0) {
            socket.emit('error-msg', 'A lista de números está vazia.');
            return;
        }

        validationState = {
            active: true,
            paused: false,
            list: numbers,
            currentIndex: 0,
            results: [],
            delay: parseInt(delay) || 1200
        };

        io.emit('validation-started', { total: numbers.length, delay: validationState.delay });
        runValidationLoop();
    });

    // Pausar validação
    socket.on('pause-validation', () => {
        if (validationState.active) {
            validationState.paused = true;
            io.emit('validation-paused');
        }
    });

    // Retomar validação
    socket.on('resume-validation', () => {
        if (validationState.active && validationState.paused) {
            validationState.paused = false;
            io.emit('validation-resumed');
        }
    });

    // Parar validação
    socket.on('stop-validation', () => {
        if (validationState.active) {
            validationState.active = false;
            validationState.paused = false;
            io.emit('validation-stopped', { results: validationState.results });
        }
    });

    // Desconectar / Deslogar WhatsApp (Método Seguro para Windows para evitar travar arquivos)
    socket.on('logout-whatsapp', async () => {
        try {
            console.log('Deslogando do WhatsApp (Remoção Segura no Windows)...');
            clientStatus = 'DISCONNECTED';
            lastQr = null;
            io.emit('status', { status: clientStatus });

            // 1. Destrói o cliente primeiro para encerrar o Puppeteer e liberar os arquivos
            if (client) {
                try {
                    await client.destroy();
                } catch (destErr) {
                    console.error('Erro ao destruir cliente no logout:', destErr);
                }
                
                // Garante que o processo do Puppeteer seja finalizado (importante no Windows)
                try {
                    if (client.pupBrowser) {
                        const proc = client.pupBrowser.process();
                        if (proc && !proc.killed) {
                            console.log('Forçando encerramento do processo Puppeteer no logout...');
                            proc.kill('SIGKILL');
                        }
                    }
                } catch (killErr) {
                    console.error('Erro ao forçar encerramento do processo no logout:', killErr);
                }
            }

            // 2. Aguarda 2 segundos para dar tempo do Windows liberar os travamentos de arquivo
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 3. Remove a pasta de sessão de forma segura
            cleanSessionDirectory();

            // 4. Cria e inicializa uma nova instância limpa
            createWhatsAppClient();

        } catch (err) {
            console.error('Erro geral durante o processo de logout:', err);
        }
    });

    // Reconectar WhatsApp manualmente
    socket.on('reconnect-whatsapp', () => {
        console.log('Solicitação manual de reconexão do WhatsApp recebida...');
        recreateWhatsAppClientGracefully();
    });
});

// Inicia servidor Express
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
