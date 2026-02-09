// ============================================
// WEBRTC CALLS MODULE - ПОЛНАЯ РЕАЛИЗАЦИЯ
// ============================================

class CallManager {
    constructor() {
        this.activeCall = null;
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.isCallActive = false;
        this.isMuted = false;
        this.isVideoOff = false;
        
        // WebRTC Configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        this.setupSocketListeners();
    }
    
    // ============================================
    // SOCKET LISTENERS
    // ============================================
    
    setupSocketListeners() {
        if (!socket) {
            console.error('❌ Socket not initialized');
            return;
        }
        
        // Входящий звонок
        socket.on('incoming-call', (data) => {
            console.log('📞 Incoming call from:', data.from);
            this.handleIncomingCall(data);
        });
        
        // Звонок принят
        socket.on('call-accepted', (data) => {
            console.log('✅ Call accepted by:', data.from);
            this.handleCallAccepted(data);
        });
        
        // Звонок отклонен
        socket.on('call-declined', (data) => {
            console.log('❌ Call declined by:', data.from);
            this.handleCallDeclined(data);
        });
        
        // WebRTC Offer
        socket.on('call-offer', async (data) => {
            console.log('📨 Received call offer from:', data.from);
            await this.handleCallOffer(data);
        });
        
        // WebRTC Answer
        socket.on('call-answer', async (data) => {
            console.log('📨 Received call answer from:', data.from);
            await this.handleCallAnswer(data);
        });
        
        // ICE Candidate
        socket.on('ice-candidate', async (data) => {
            console.log('🧊 Received ICE candidate from:', data.from);
            await this.handleIceCandidate(data);
        });
        
        // Звонок завершен
        socket.on('call-ended', (data) => {
            console.log('📵 Call ended by:', data.from);
            this.endCall();
        });
    }
    
    // ============================================
    // ИНИЦИАЦИЯ ЗВОНКА
    // ============================================
    
    async startVoiceCall(friendId) {
        console.log('📞 Starting voice call with:', friendId);
        
        const friend = this.getFriend(friendId);
        if (!friend) {
            showError('Friend not found');
            return;
        }
        
        this.activeCall = {
            friendId: friendId,
            friend: friend,
            type: 'voice',
            direction: 'outgoing',
            startTime: Date.now()
        };
        
        this.showCallWindow(friend, 'voice', 'outgoing');
        
        // Отправляем сигнал о начале звонка БЕЗ запроса медиа
        // Медиа запросим только когда собеседник ответит
        if (socket && socket.connected) {
            socket.emit('call-initiate', {
                to: friendId,
                from: state.user.id,
                type: 'voice'
            });
            console.log('📤 Call initiate signal sent');
        } else {
            console.error('❌ Socket not connected');
            this.updateCallStatus('❌ Connection error', '#f87171');
        }
    }
    
    async startVideoCall(friendId) {
        console.log('📹 Starting video call with:', friendId);
        
        const friend = this.getFriend(friendId);
        if (!friend) {
            showError('Friend not found');
            return;
        }
        
        this.activeCall = {
            friendId: friendId,
            friend: friend,
            type: 'video',
            direction: 'outgoing',
            startTime: Date.now()
        };
        
        this.showCallWindow(friend, 'video', 'outgoing');
        
        // Отправляем сигнал о начале звонка БЕЗ запроса медиа
        // Медиа запросим только когда собеседник ответит
        if (socket && socket.connected) {
            socket.emit('call-initiate', {
                to: friendId,
                from: state.user.id,
                type: 'video'
            });
            console.log('📤 Video call initiate signal sent');
        } else {
            console.error('❌ Socket not connected');
            this.updateCallStatus('❌ Connection error', '#f87171');
        }
    }
    
    // ============================================
    // ОБРАБОТКА ВХОДЯЩЕГО ЗВОНКА
    // ============================================
    
    handleIncomingCall(data) {
        const { from, type } = data;
        
        this.activeCall = {
            friendId: from._id || from.id,
            friend: from,
            type: type,
            direction: 'incoming',
            startTime: Date.now()
        };
        
        this.showCallWindow(from, type, 'incoming');
        
        // Показываем уведомление
        if (Notification.permission === 'granted') {
            new Notification('Incoming Call', {
                body: `${from.username} is calling you`,
                icon: from.avatar || '📞',
                tag: 'call-notification'
            });
        }
        
        // Воспроизводим звук звонка (опционально)
        this.playRingtone();
    }
    
    // ============================================
    // ПРИНЯТИЕ ЗВОНКА
    // ============================================
    
    async acceptCall() {
        console.log('✅ Accepting call');
        
        if (!this.activeCall) {
            console.error('❌ No active call to accept');
            return;
        }
        
        this.stopRingtone();
        this.updateCallStatus('🔄 Connecting...', '#4a9eff');
        
        // Запрашиваем доступ к медиа
        try {
            const constraints = {
                audio: true,
                video: this.activeCall.type === 'video'
            };
            
            console.log('🎤 Requesting media access:', constraints);
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('✅ Media access granted');
            
            if (this.activeCall.type === 'video') {
                this.displayLocalVideo();
            }
            
            // Отправляем подтверждение
            if (socket && socket.connected) {
                socket.emit('call-accept', {
                    to: this.activeCall.friendId,
                    from: state.user.id
                });
                console.log('📤 Call accept signal sent');
            }
            
            // Обновляем UI
            this.updateCallStatus('✅ Connected', '#31c48d');
            
            // Создаем WebRTC соединение
            await this.createPeerConnection();
            
        } catch (error) {
            console.error('❌ Failed to accept call:', error);
            this.updateCallStatus('❌ Media access denied', '#f87171');
            showError('Failed to access microphone/camera. Please allow access and try again.');
            
            // НЕ закрываем окно, даем пользователю попробовать еще раз
            setTimeout(() => {
                this.updateCallStatus('📞 Click to retry', '#8b92a0');
            }, 3000);
        }
    }
    
    // ============================================
    // ОТКЛОНЕНИЕ ЗВОНКА
    // ============================================
    
    declineCall() {
        console.log('❌ Declining call');
        
        if (!this.activeCall) return;
        
        this.stopRingtone();
        
        socket.emit('call-decline', {
            to: this.activeCall.friendId,
            from: state.user.id
        });
        
        this.endCall();
    }
    
    // ============================================
    // WEBRTC СОЕДИНЕНИЕ
    // ============================================
    
    async createPeerConnection() {
        console.log('🔗 Creating peer connection');
        
        this.peerConnection = new RTCPeerConnection(this.rtcConfig);
        
        // Добавляем локальные треки
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }
        
        // Обработка удаленных треков
        this.peerConnection.ontrack = (event) => {
            console.log('📥 Received remote track');
            this.remoteStream = event.streams[0];
            this.displayRemoteVideo();
        };
        
        // Обработка ICE кандидатов
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 Sending ICE candidate');
                socket.emit('ice-candidate', {
                    to: this.activeCall.friendId,
                    candidate: event.candidate
                });
            }
        };
        
        // Обработка изменения состояния соединения
        this.peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Connection state:', this.peerConnection.connectionState);
            
            if (this.peerConnection.connectionState === 'connected') {
                this.updateCallStatus('✅ Connected', '#31c48d');
                this.isCallActive = true;
            } else if (this.peerConnection.connectionState === 'disconnected' || 
                       this.peerConnection.connectionState === 'failed') {
                this.endCall();
            }
        };
        
        // Если мы инициатор, создаем offer
        if (this.activeCall.direction === 'outgoing') {
            await this.createOffer();
        }
    }
    
    async createOffer() {
        console.log('📤 Creating offer');
        
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            socket.emit('call-offer', {
                to: this.activeCall.friendId,
                offer: offer
            });
            
        } catch (error) {
            console.error('❌ Failed to create offer:', error);
            this.endCall();
        }
    }
    
    async handleCallOffer(data) {
        console.log('📨 Handling call offer');
        
        try {
            await this.createPeerConnection();
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            socket.emit('call-answer', {
                to: data.from,
                answer: answer
            });
            
        } catch (error) {
            console.error('❌ Failed to handle offer:', error);
            this.endCall();
        }
    }
    
    async handleCallAnswer(data) {
        console.log('📨 Handling call answer');
        
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            this.updateCallStatus('✅ Connected', '#31c48d');
            this.isCallActive = true;
        } catch (error) {
            console.error('❌ Failed to handle answer:', error);
            this.endCall();
        }
    }
    
    async handleIceCandidate(data) {
        console.log('🧊 Handling ICE candidate');
        
        try {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            console.error('❌ Failed to add ICE candidate:', error);
        }
    }
    
    async handleCallAccepted(data) {
        console.log('✅ Call accepted by remote peer');
        this.updateCallStatus('🔄 Connecting...', '#4a9eff');
        
        // Теперь запрашиваем доступ к медиа
        try {
            const constraints = {
                audio: true,
                video: this.activeCall.type === 'video'
            };
            
            console.log('🎤 Requesting media access:', constraints);
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('✅ Media access granted');
            
            if (this.activeCall.type === 'video') {
                this.displayLocalVideo();
            }
            
            // Создаем WebRTC соединение
            await this.createPeerConnection();
            
        } catch (error) {
            console.error('❌ Failed to get media access:', error);
            this.updateCallStatus('❌ Media access denied', '#f87171');
            showError('Failed to access microphone/camera. Please allow access.');
            
            // Отправляем сигнал об ошибке
            if (socket && socket.connected) {
                socket.emit('call-error', {
                    to: this.activeCall.friendId,
                    error: 'media_access_denied'
                });
            }
        }
    }
    
    handleCallDeclined(data) {
        console.log('❌ Call declined');
        showError('Call declined');
        this.endCall();
    }
    
    // ============================================
    // УПРАВЛЕНИЕ ЗВОНКОМ
    // ============================================
    
    toggleMute() {
        if (!this.localStream) return;
        
        this.isMuted = !this.isMuted;
        
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });
        
        const btn = document.getElementById('callMuteBtn');
        if (btn) {
            btn.textContent = this.isMuted ? '🔇' : '🎤';
            btn.style.background = this.isMuted ? '#f87171' : '#2f3339';
        }
        
        console.log(this.isMuted ? '🔇 Muted' : '🎤 Unmuted');
    }
    
    toggleVideo() {
        if (!this.localStream) return;
        
        this.isVideoOff = !this.isVideoOff;
        
        this.localStream.getVideoTracks().forEach(track => {
            track.enabled = !this.isVideoOff;
        });
        
        const btn = document.getElementById('callVideoBtn');
        if (btn) {
            btn.textContent = this.isVideoOff ? '🚫' : '📹';
            btn.style.background = this.isVideoOff ? '#f87171' : '#2f3339';
        }
        
        console.log(this.isVideoOff ? '🚫 Video off' : '📹 Video on');
    }
    
    endCall() {
        console.log('📵 Ending call');
        
        // Очищаем таймаут
        if (this.callTimeout) {
            clearTimeout(this.callTimeout);
            this.callTimeout = null;
        }
        
        // Останавливаем все треки
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }
        
        // Закрываем peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Отправляем сигнал о завершении
        if (this.activeCall && socket && socket.connected) {
            socket.emit('call-end', {
                to: this.activeCall.friendId,
                from: state.user.id
            });
        }
        
        // Останавливаем рингтон
        this.stopRingtone();
        
        // Удаляем окно звонка
        const callWindow = document.getElementById('callWindow');
        if (callWindow) {
            callWindow.remove();
        }
        
        // Сбрасываем состояние
        this.activeCall = null;
        this.isCallActive = false;
        this.isMuted = false;
        this.isVideoOff = false;
        
        showSuccess('Call ended');
    }
    
    // ============================================
    // UI ФУНКЦИИ
    // ============================================
    
    showCallWindow(friend, type, direction) {
        // Удаляем существующее окно
        const existing = document.getElementById('callWindow');
        if (existing) existing.remove();
        
        const isVideo = type === 'video';
        const isOutgoing = direction === 'outgoing';
        
        const callWindow = document.createElement('div');
        callWindow.id = 'callWindow';
        callWindow.style.cssText = `
            position: fixed;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 480px;
            background: #242831;
            border-radius: 0 0 16px 16px;
            padding: 20px 24px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            z-index: 9999;
            border: 1px solid #2f3339;
            border-top: none;
        `;
        
        callWindow.innerHTML = `
            <div style="display: flex; align-items: center; gap: 16px;">
                <div class="avatar" style="width: 48px; height: 48px; font-size: 24px; flex-shrink: 0;">
                    ${friend.avatar && friend.avatar.startsWith('data:') ? 
                        `<img src="${friend.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">` :
                        `<span class="avatar-text">${friend.avatar || '👤'}</span>`
                    }
                </div>
                <div style="flex: 1; min-width: 0;">
                    <h3 style="color: #e4e6eb; margin: 0 0 4px 0; font-size: 16px; font-weight: 600;">${friend.username}</h3>
                    <p id="callStatus" style="color: #8b92a0; font-size: 13px; margin: 0;">
                        ${isOutgoing ? '📞 Calling...' : '📞 Incoming call...'}
                    </p>
                    <div id="callTimer" style="color: #4a9eff; font-size: 12px; margin-top: 4px; display: none; font-weight: 500;">
                        00:00
                    </div>
                </div>
                
                <div id="callControls" style="display: flex; gap: 8px; align-items: center;">
                    ${!isOutgoing ? `
                        <button onclick="callManager.acceptCall()" style="width: 40px; height: 40px; border-radius: 50%; 
                                background: linear-gradient(135deg, #31c48d, #25a06e); border: none; 
                                color: white; font-size: 18px; cursor: pointer; transition: transform 0.2s;"
                                onmouseover="this.style.transform='scale(1.1)'" 
                                onmouseout="this.style.transform='scale(1)'" title="Accept">
                            ✅
                        </button>
                    ` : ''}
                    <button onclick="callManager.toggleMute()" id="callMuteBtn" style="width: 40px; height: 40px; 
                            border-radius: 50%; background: #2f3339; border: none; color: #e4e6eb; 
                            font-size: 18px; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.background='#3a3f47'" 
                            onmouseout="this.style.background='${this.isMuted ? '#f87171' : '#2f3339'}'" title="Mute">
                        🎤
                    </button>
                    ${isVideo ? `
                        <button onclick="callManager.toggleVideo()" id="callVideoBtn" style="width: 40px; height: 40px; 
                                border-radius: 50%; background: #2f3339; border: none; color: #e4e6eb; 
                                font-size: 18px; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.background='#3a3f47'" 
                                onmouseout="this.style.background='${this.isVideoOff ? '#f87171' : '#2f3339'}'" title="Video">
                            📹
                        </button>
                    ` : ''}
                    <button onclick="${isOutgoing ? 'callManager.endCall()' : 'callManager.declineCall()'}()" 
                            style="width: 40px; height: 40px; border-radius: 50%; 
                            background: linear-gradient(135deg, #f87171, #dc2626); border: none; 
                            color: white; font-size: 18px; cursor: pointer; transition: transform 0.2s;"
                            onmouseover="this.style.transform='scale(1.1)'" 
                            onmouseout="this.style.transform='scale(1)'" title="${isOutgoing ? 'End call' : 'Decline'}">
                        ${isOutgoing ? '📵' : '❌'}
                    </button>
                </div>
            </div>
            
            ${isVideo ? `
                <div id="videoContainer" style="position: relative; background: #1a1d23; border-radius: 12px; 
                            height: 300px; margin-top: 16px; overflow: hidden;">
                    <video id="remoteVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                    <video id="localVideo" autoplay playsinline muted style="position: absolute; bottom: 12px; right: 12px; 
                            width: 120px; height: 90px; border-radius: 8px; border: 2px solid #2f3339; object-fit: cover;"></video>
                </div>
            ` : ''}
        `;
        
        document.body.appendChild(callWindow);
        
        // Автоматическое завершение через 30 секунд если не отвечают
        if (isOutgoing) {
            this.callTimeout = setTimeout(() => {
                const status = document.getElementById('callStatus');
                if (status && status.textContent.includes('Calling')) {
                    this.updateCallStatus('❌ No answer', '#f87171');
                    setTimeout(() => {
                        this.endCall();
                        showError('Call not answered');
                    }, 2000);
                }
            }, 30000);
        }
    }
    
    updateCallStatus(text, color) {
        const status = document.getElementById('callStatus');
        if (status) {
            status.textContent = text;
            status.style.color = color;
        }
        
        // Показываем таймер если соединение установлено
        if (text.includes('Connected')) {
            this.startCallTimer();
        }
    }
    
    startCallTimer() {
        const timerEl = document.getElementById('callTimer');
        if (!timerEl) return;
        
        timerEl.style.display = 'block';
        
        const startTime = Date.now();
        const interval = setInterval(() => {
            if (!this.isCallActive) {
                clearInterval(interval);
                return;
            }
            
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            
            if (timerEl) {
                timerEl.textContent = `${minutes}:${seconds}`;
            }
        }, 1000);
    }
    
    displayLocalVideo() {
        const localVideo = document.getElementById('localVideo');
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
        }
    }
    
    displayRemoteVideo() {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && this.remoteStream) {
            remoteVideo.srcObject = this.remoteStream;
        }
    }
    
    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================
    
    getFriend(friendId) {
        // Ищем друга в списке друзей
        let friend = state.friends.find(f => f._id === friendId);
        
        // Если не нашли, ищем в участниках DM
        if (!friend && state.activeDM) {
            const dm = state.dms.find(d => d._id === state.activeDM);
            if (dm && dm.participants) {
                friend = dm.participants.find(p => p._id === friendId);
            }
        }
        
        return friend;
    }
    
    playRingtone() {
        // Можно добавить воспроизведение звука
        console.log('🔔 Playing ringtone');
    }
    
    stopRingtone() {
        // Останавливаем звук
        console.log('🔕 Stopping ringtone');
    }
}

// ============================================
// ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ СОВМЕСТИМОСТИ
// ============================================

let callManager = null;

// Инициализация при загрузке
function initCallManager() {
    if (!callManager) {
        callManager = new CallManager();
        console.log('✅ Call Manager initialized');
    }
}

// Экспортируем функции для использования в HTML
window.startVoiceCall = (friendId) => {
    if (!callManager) initCallManager();
    callManager.startVoiceCall(friendId);
};

window.startVideoCall = (friendId) => {
    if (!callManager) initCallManager();
    callManager.startVideoCall(friendId);
};

window.acceptCall = () => {
    if (callManager) callManager.acceptCall();
};

window.declineCall = () => {
    if (callManager) callManager.declineCall();
};

window.toggleCallMute = () => {
    if (callManager) callManager.toggleMute();
};

window.toggleCallVideo = () => {
    if (callManager) callManager.toggleVideo();
};

window.endCall = () => {
    if (callManager) callManager.endCall();
};

console.log('📞 Calls module loaded!');
