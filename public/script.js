document.addEventListener('DOMContentLoaded', () => {
    // Inicializa o Socket.io
    const socket = io();

    // Elementos DOM - Status de Conexão
    const connectionBadge = document.getElementById('connection-badge');
    const statusDot = connectionBadge.querySelector('.status-dot');
    const statusText = document.getElementById('connection-status-text');
    
    const stateDisconnected = document.getElementById('state-disconnected');
    const stateInitializing = document.getElementById('state-initializing');
    const stateQr = document.getElementById('state-qr');
    const stateConnecting = document.getElementById('state-connecting');
    const stateConnected = document.getElementById('state-connected');
    
    const qrImg = document.getElementById('qr-img');
    const btnReconnect = document.getElementById('btn-reconnect');
    const btnLogout = document.getElementById('btn-logout');

    // Elementos DOM - Entrada de Dados
    const numbersTextarea = document.getElementById('numbers-textarea');
    const fileDropzone = document.getElementById('file-dropzone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');
    const selectedFileName = document.getElementById('selected-file-name');
    const btnClearFile = document.getElementById('btn-clear-file');
    const delayInput = document.getElementById('delay-input');
    const btnStart = document.getElementById('btn-start');

    // Elementos DOM - Dashboard & KPIs
    const kpiTotal = document.getElementById('kpi-total');
    const kpiChecked = document.getElementById('kpi-checked');
    const kpiValid = document.getElementById('kpi-valid');
    const kpiInvalid = document.getElementById('kpi-invalid');
    const kpiCardChecked = document.querySelector('.kpi-card.checked');

    // Elementos DOM - Painel de Progresso
    const progressCard = document.getElementById('progress-card');
    const progressText = document.getElementById('validation-progress-text');
    const percentageText = document.getElementById('validation-percentage-text');
    const progressBarFill = document.getElementById('progress-bar-fill');
    
    const btnPause = document.getElementById('btn-pause');
    const btnResume = document.getElementById('btn-resume');
    const btnStop = document.getElementById('btn-stop');

    // Elementos DOM - Tabela de Resultados
    const resultsTbody = document.getElementById('results-tbody');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const btnExportTxt = document.getElementById('btn-export-txt');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnClearResults = document.getElementById('btn-clear-results');

    // Estado da Aplicação Local
    let totalNumbers = 0;
    let checkedCount = 0;
    let validCount = 0;
    let invalidCount = 0;
    let allResults = []; // Armazena todos os resultados da validação ativa
    let currentFilter = 'all'; // all, valid, invalid

    // ==========================================
    // 1. GERENCIAMENTO DE CONEXÃO DO WHATSAPP
    // ==========================================
    
    socket.on('status', (data) => {
        const status = data.status;
        const qrUrl = data.qr;
        
        // Atualiza a Pill de Conexão no Header
        statusDot.className = 'status-dot';
        statusDot.classList.add(status.toLowerCase());
        
        // Esconde todos os containers de estado de conexão
        [stateDisconnected, stateInitializing, stateQr, stateConnecting, stateConnected].forEach(el => el.style.display = 'none');

        switch (status) {
            case 'DISCONNECTED':
                statusText.innerText = 'Desconectado';
                stateDisconnected.style.display = 'flex';
                btnStart.disabled = true;
                if (data.message) {
                    const descEl = stateDisconnected.querySelector('.state-desc');
                    if (descEl) descEl.innerText = data.message;
                }
                break;
            case 'INITIALIZING':
                statusText.innerText = 'Inicializando...';
                stateInitializing.style.display = 'flex';
                btnStart.disabled = true;
                break;
            case 'QR_READY':
                statusText.innerText = 'Aguardando QR Code';
                stateQr.style.display = 'flex';
                if (qrUrl) {
                    qrImg.src = qrUrl;
                }
                btnStart.disabled = true;
                break;
            case 'CONNECTING':
                statusText.innerText = 'Conectando...';
                stateConnecting.style.display = 'flex';
                btnStart.disabled = true;
                break;
            case 'CONNECTED':
                statusText.innerText = 'Conectado';
                stateConnected.style.display = 'flex';
                // Habilita o botão de Iniciar se houver texto
                checkStartButtonState();
                break;
        }
    });

    // reconectar e deslogar
    btnReconnect.addEventListener('click', () => {
        statusText.innerText = 'Inicializando...';
        stateDisconnected.style.display = 'none';
        stateInitializing.style.display = 'flex';
        socket.emit('reconnect-whatsapp');
    });

    btnLogout.addEventListener('click', () => {
        if (confirm('Tem certeza que deseja desconectar o WhatsApp desta sessão?')) {
            socket.emit('logout-whatsapp');
        }
    });

    // ==========================================
    // 2. IMPORTAÇÃO E UPLOAD DE ARQUIVOS (TXT / CSV)
    // ==========================================

    // Ao digitar na Área de Texto, valida se o botão pode ser habilitado
    numbersTextarea.addEventListener('input', checkStartButtonState);

    function checkStartButtonState() {
        const text = numbersTextarea.value.trim();
        const isConnected = statusText.innerText === 'Conectado';
        btnStart.disabled = !(text.length > 0 && isConnected);
    }

    // Drag-and-drop eventos
    fileDropzone.addEventListener('click', () => fileInput.click());

    fileDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropzone.classList.add('dragover');
    });

    fileDropzone.addEventListener('dragleave', () => {
        fileDropzone.classList.remove('dragover');
    });

    fileDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleUploadedFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleUploadedFile(e.target.files[0]);
        }
    });

    // Processa o arquivo carregado
    function handleUploadedFile(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            // Extrai números
            const lines = text.split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0);
            
            if (lines.length > 0) {
                // Preenche a textarea com a lista de números carregada
                numbersTextarea.value = lines.join('\n');
                
                // Exibe informações do arquivo
                selectedFileName.innerText = `${file.name} (${lines.length} números)`;
                fileInfo.style.display = 'flex';
                
                checkStartButtonState();
            } else {
                alert('Nenhum número válido encontrado no arquivo.');
            }
        };
        reader.readAsText(file);
    }

    // Limpar arquivo selecionado
    btnClearFile.addEventListener('click', () => {
        fileInput.value = '';
        fileInfo.style.display = 'none';
        numbersTextarea.value = '';
        checkStartButtonState();
    });

    // ==========================================
    // 3. CONTROLE DE EXECUÇÃO DA VALIDAÇÃO
    // ==========================================

    btnStart.addEventListener('click', () => {
        const text = numbersTextarea.value.trim();
        if (!text) return;

        // Limpa e formata a lista de números
        const numbers = text.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (numbers.length === 0) return;

        const delay = delayInput.value || 1200;

        // Inicia via Socket
        socket.emit('start-validation', { numbers, delay });
    });

    btnPause.addEventListener('click', () => socket.emit('pause-validation'));
    btnResume.addEventListener('click', () => socket.emit('resume-validation'));
    btnStop.addEventListener('click', () => {
        if (confirm('Deseja realmente interromper o processo de validação atual?')) {
            socket.emit('stop-validation');
        }
    });

    // Eventos de Progresso do Socket.io
    socket.on('validation-started', (data) => {
        // Reinicializa contadores locais
        totalNumbers = data.total;
        checkedCount = 0;
        validCount = 0;
        invalidCount = 0;
        allResults = [];

        kpiTotal.innerText = totalNumbers;
        kpiChecked.innerText = '0';
        kpiValid.innerText = '0';
        kpiInvalid.innerText = '0';

        // Mostra o card de progresso
        progressCard.style.display = 'flex';
        btnPause.style.display = 'inline-flex';
        btnResume.style.display = 'none';
        progressText.innerText = 'Validando números...';
        percentageText.innerText = '0%';
        progressBarFill.style.width = '0%';

        // Adiciona classe de animação ao KPI de processados
        kpiCardChecked.classList.add('running');

        // Reseta Tabela
        resultsTbody.innerHTML = '';

        // Bloqueia inputs
        numbersTextarea.disabled = true;
        fileDropzone.style.pointerEvents = 'none';
        fileDropzone.style.opacity = '0.5';
        delayInput.disabled = true;
        btnStart.disabled = true;
    });

    socket.on('validation-item', (data) => {
        const { index, result } = data;
        
        checkedCount++;
        kpiChecked.innerText = checkedCount;

        if (result.isValid) {
            validCount++;
            kpiValid.innerText = validCount;
        } else {
            invalidCount++;
            kpiInvalid.innerText = invalidCount;
        }

        // Armazena resultado
        allResults.push(result);

        // Atualiza a Barra de Progresso
        const pct = Math.round((checkedCount / totalNumbers) * 100);
        percentageText.innerText = `${pct}%`;
        progressBarFill.style.width = `${pct}%`;
        progressText.innerText = `Processando: ${checkedCount} de ${totalNumbers}`;

        // Insere a nova linha na tabela
        addResultToTable(result);
    });

    socket.on('validation-paused', (data) => {
        progressText.innerText = (data && data.message) ? data.message : 'Validação pausada';
        btnPause.style.display = 'none';
        btnResume.style.display = 'inline-flex';
        kpiCardChecked.classList.remove('running');
    });

    socket.on('validation-resumed', () => {
        progressText.innerText = 'Validando números...';
        btnPause.style.display = 'inline-flex';
        btnResume.style.display = 'none';
        kpiCardChecked.classList.add('running');
    });

    // Processo encerrado por completo (fim da lista ou parada manual)
    socket.on('validation-complete', (data) => {
        finishValidation('Validação Concluída!', data.results);
    });

    socket.on('validation-stopped', (data) => {
        finishValidation('Validação Interrompida', data.results);
    });

    socket.on('error-msg', (msg) => {
        alert('Erro: ' + msg);
    });

    // Lida com o status inicial ao recarregar a página e já ter validação ativa no backend
    socket.on('validation-status', (data) => {
        totalNumbers = data.total;
        allResults = data.results;
        checkedCount = data.currentIndex;
        
        validCount = allResults.filter(r => r.isValid).length;
        invalidCount = allResults.filter(r => !r.isValid).length;

        kpiTotal.innerText = totalNumbers;
        kpiChecked.innerText = checkedCount;
        kpiValid.innerText = validCount;
        kpiInvalid.innerText = invalidCount;

        // Renderiza tudo na tabela
        resultsTbody.innerHTML = '';
        if (allResults.length > 0) {
            allResults.forEach(r => addResultToTable(r));
        } else {
            resultsTbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="5" class="no-data">Nenhum número validado ainda. Insira a lista e clique em Iniciar.</td>
                </tr>
            `;
        }

        if (data.active) {
            progressCard.style.display = 'flex';
            const pct = Math.round((checkedCount / totalNumbers) * 100);
            percentageText.innerText = `${pct}%`;
            progressBarFill.style.width = `${pct}%`;
            progressText.innerText = data.paused ? 'Validação pausada' : 'Validando números...';

            if (data.paused) {
                btnPause.style.display = 'none';
                btnResume.style.display = 'inline-flex';
                kpiCardChecked.classList.remove('running');
            } else {
                btnPause.style.display = 'inline-flex';
                btnResume.style.display = 'none';
                kpiCardChecked.classList.add('running');
            }

            // Bloqueia inputs
            numbersTextarea.disabled = true;
            fileDropzone.style.pointerEvents = 'none';
            fileDropzone.style.opacity = '0.5';
            delayInput.disabled = true;
            btnStart.disabled = true;
        }
    });

    function finishValidation(titleMessage, finalResults) {
        progressText.innerText = titleMessage;
        btnPause.style.display = 'none';
        btnResume.style.display = 'none';
        kpiCardChecked.classList.remove('running');
        
        // Atualiza a lista completa
        allResults = finalResults;

        // Restaura os controles
        numbersTextarea.disabled = false;
        fileDropzone.style.pointerEvents = 'auto';
        fileDropzone.style.opacity = '1';
        delayInput.disabled = false;
        checkStartButtonState();
    }

    // ==========================================
    // 4. TABELA DE RESULTADOS E FILTROS
    // ==========================================

    function addResultToTable(result) {
        // Se a tabela tem a linha vazia de placeholder, remove ela
        const emptyRow = resultsTbody.querySelector('.empty-row');
        if (emptyRow) {
            resultsTbody.innerHTML = '';
        }

        const tr = document.createElement('tr');
        tr.dataset.status = result.isValid ? 'valid' : 'invalid';

        // Oculta a linha se houver um filtro ativo que não bata com o status
        if (currentFilter === 'valid' && !result.isValid) {
            tr.style.display = 'none';
        } else if (currentFilter === 'invalid' && result.isValid) {
            tr.style.display = 'none';
        }

        // Avatar / Foto
        let avatarTd = `<div class="profile-pic-container"><div class="avatar-fallback"><i class="fa-solid fa-user"></i></div></div>`;
        if (result.isValid && result.profilePic) {
            avatarTd = `<div class="profile-pic-container"><img class="avatar" src="${result.profilePic}" alt="Foto de perfil"></div>`;
        }

        // Status Badge
        const statusBadge = result.isValid 
            ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Válido</span>`
            : `<span class="badge badge-danger"><i class="fa-solid fa-circle-xmark"></i> Inválido</span>`;

        // Detalhes / Formatos
        const numberOriginal = result.raw;
        const numberFormatted = result.isValid ? `<span class="text-success-val">${result.formatted.split('@')[0]}</span>` : `<span class="text-muted-val">-</span>`;
        const details = result.error ? `<span class="text-danger-val">${result.error}</span>` : (result.isValid ? 'Número ativo no WhatsApp' : 'Não cadastrado no WhatsApp');

        tr.innerHTML = `
            <td>${avatarTd}</td>
            <td>${numberOriginal}</td>
            <td>${numberFormatted}</td>
            <td>${statusBadge}</td>
            <td>${details}</td>
        `;

        // Adiciona no topo ou fim. Vamos colocar no topo para facilitar a visualização em listas longas
        resultsTbody.insertBefore(tr, resultsTbody.firstChild);
    }

    // Filtros de Tabela (Todos, Válidos, Inválidos)
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const filter = btn.dataset.filter;
            currentFilter = filter;

            const rows = resultsTbody.querySelectorAll('tr:not(.empty-row)');
            rows.forEach(row => {
                const status = row.dataset.status;
                if (filter === 'all') {
                    row.style.display = '';
                } else if (filter === 'valid') {
                    row.style.display = (status === 'valid') ? '' : 'none';
                } else if (filter === 'invalid') {
                    row.style.display = (status === 'invalid') ? '' : 'none';
                }
            });
        });
    });

    // Limpar Resultados Completamente
    btnClearResults.addEventListener('click', () => {
        if (confirm('Deseja limpar todos os resultados da tela?')) {
            allResults = [];
            resultsTbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="5" class="no-data">Nenhum número validado ainda. Insira a lista e clique em Iniciar.</td>
                </tr>
            `;
            kpiTotal.innerText = '0';
            kpiChecked.innerText = '0';
            kpiValid.innerText = '0';
            kpiInvalid.innerText = '0';
            progressCard.style.display = 'none';
            totalNumbers = 0;
            checkedCount = 0;
            validCount = 0;
            invalidCount = 0;
        }
    });

    // ==========================================
    // 5. EXPORTAÇÃO DOS NÚMEROS VÁLIDOS
    // ==========================================

    btnExportTxt.addEventListener('click', () => {
        const validList = allResults
            .filter(item => item.isValid)
            .map(item => item.formatted.split('@')[0]);

        if (validList.length === 0) {
            alert('Não há números válidos para exportar.');
            return;
        }

        const blob = new Blob([validList.join('\r\n')], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, 'numeros_validos.txt');
    });

    btnExportCsv.addEventListener('click', () => {
        const validList = allResults.filter(item => item.isValid);

        if (validList.length === 0) {
            alert('Não há números válidos para exportar.');
            return;
        }

        let csvContent = 'Numero Original,Numero Formatado JID\r\n';
        validList.forEach(item => {
            csvContent += `"${item.raw}","${item.formatted.split('@')[0]}"\r\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, 'numeros_validos.csv');
    });

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});
