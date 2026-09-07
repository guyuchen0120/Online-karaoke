const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const os = require('os');

// ===== 添加 JSON 解析 =====
app.use(express.json());
app.use(express.static('./'));

app.get('/get-local-ip', (req, res) => {
    const nets = os.networkInterfaces();
    let ip = '127.0.0.1';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ip = net.address;
                break;
            }
        }
    }
    res.json({ ip });
});

// ===== HTTP点歌接口（压测用） =====
app.post('/add-song', (req, res) => {
    const { title, singer, requester, area, remark } = req.body;
    
    if (!title || !requester) {
        return res.status(400).json({ error: '歌名和名字不能为空' });
    }

    if (area === 'karaoke') {
        const active = songs.filter(s => 
            s.requester === requester && 
            s.area === 'karaoke' &&
            (s.status === 'pending' || s.status === 'singing')
        );
        if (active.length >= 1) {
            return res.status(400).json({ 
                error: `❌ ${requester}，你已点了一首《${active[0].title}》，唱完才能点下一首！` 
            });
        }
    }

    const newSong = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        title: title.trim(),
        singer: singer || '🎵',
        requester: requester.trim(),
        status: 'pending',
        area: area || 'song',
        remark: remark || '',
        isControlTime: false,
        createdAt: Date.now()
    };
    
    songs.push(newSong);
    io.emit('song_added', newSong);
    broadcastState();
    
    console.log(`🎵 HTTP点歌: ${title} by ${requester}`);
    res.json({ success: true, song: newSong });
});

// ===== 获取歌曲列表（压测验证） =====
app.get('/api/songs', (req, res) => {
    res.json({ songs, total: songs.length });
});

// ---------- 数据 ----------
let songs = [];
let currentSongId = null;
let userCount = 0;

function broadcastState() {
    io.emit('state', {
        songs: songs,
        currentSongId: currentSongId,
        userCount: userCount
    });
}

io.on('connection', (socket) => {
    userCount++;
    console.log(`用户连接，当前人数: ${userCount}`);
    socket.emit('state', { songs, currentSongId, userCount });
    io.emit('user_count', userCount);

    // 点歌（WebSocket方式）
    socket.on('add_song', (data) => {
        const { title, singer, requester, area, remark } = data;
        if (!title || !requester) {
            socket.emit('error_msg', '歌名和名字不能为空');
            return;
        }

        if (area === 'karaoke') {
            const active = songs.filter(s => 
                s.requester === requester && 
                s.area === 'karaoke' &&
                (s.status === 'pending' || s.status === 'singing')
            );
            if (active.length >= 1) {
                socket.emit('error_msg', `❌ ${requester}，你已点了一首《${active[0].title}》，唱完才能点下一首！`);
                return;
            }
        }

        const newSong = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            title: title.trim(),
            singer: singer || '🎵',
            requester: requester.trim(),
            status: 'pending',
            area: area || 'song',
            remark: remark || '',
            isControlTime: false,
            createdAt: Date.now()
        };
        songs.push(newSong);
        io.emit('song_added', newSong);
        broadcastState();
    });

    // 控场时间
    socket.on('add_control_time', (data) => {
        const { title, requester, area } = data;
        
        const pendingSongs = songs.filter(s => s.area === 'karaoke' && s.status === 'pending');
        let controlCreatedAt = Date.now();
        
        if (pendingSongs.length > 0) {
            const earliestPending = pendingSongs.reduce((min, s) => s.createdAt < min.createdAt ? s : min);
            controlCreatedAt = earliestPending.createdAt - 1;
        }
        
        const controlSong = {
            id: 'ctrl_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
            title: '⏰ ' + title.trim(),
            singer: '🎛️ 控场',
            requester: requester || '🎛️ 主控',
            status: 'pending',
            area: area || 'karaoke',
            remark: '⏰ 控场时间',
            isControlTime: true,
            createdAt: controlCreatedAt
        };
        
        songs.push(controlSong);
        io.emit('song_added', controlSong);
        broadcastState();
        console.log(`⏰ 控场时间已置顶: ${title}`);
    });

    // 开始唱
    socket.on('start_sing', (id) => {
        let targetSong = null;
        
        if (id) {
            targetSong = songs.find(s => s.id === id);
        }
        
        if (!targetSong || targetSong.area !== 'karaoke') {
            const pendingSongs = songs
                .filter(s => s.area === 'karaoke' && s.status === 'pending')
                .sort((a, b) => a.createdAt - b.createdAt);
            
            if (pendingSongs.length === 0) {
                socket.emit('error_msg', 'K歌区没有待唱歌曲');
                return;
            }
            targetSong = pendingSongs[0];
        }
        
        if (!targetSong) {
            socket.emit('error_msg', '没有找到可开唱的歌曲');
            return;
        }
        
        const singing = songs.find(s => s.area === 'karaoke' && s.status === 'singing');
        if (singing) singing.status = 'pending';
        
        targetSong.status = 'singing';
        currentSongId = targetSong.id;
        broadcastState();
        
        if (targetSong.isControlTime) {
            io.emit('control_time_started', { title: targetSong.title });
            console.log(`⏰ 控场时间开始: ${targetSong.title}`);
        }
    });

    // 标记唱完
    socket.on('mark_done', (id) => {
        const song = songs.find(s => s.id === id);
        if (!song) {
            socket.emit('error_msg', '歌曲不存在');
            return;
        }
        
        if (song.isControlTime) {
            const index = songs.findIndex(s => s.id === id);
            if (index !== -1) {
                songs.splice(index, 1);
            }
            if (currentSongId === id) {
                currentSongId = null;
                const nextPending = songs
                    .filter(s => s.area === 'karaoke' && s.status === 'pending')
                    .sort((a, b) => a.createdAt - b.createdAt);
                if (nextPending.length > 0) {
                    nextPending[0].status = 'singing';
                    currentSongId = nextPending[0].id;
                }
            }
            broadcastState();
            io.emit('control_time_ended', { id });
            console.log(`⏰ 控场时间已结束并移除: ${song.title}`);
            return;
        }
        
        song.status = 'done';
        if (currentSongId === song.id) {
            const nextPending = songs
                .filter(s => s.area === 'karaoke' && s.status === 'pending')
                .sort((a, b) => a.createdAt - b.createdAt);
            if (nextPending.length > 0) {
                nextPending[0].status = 'singing';
                currentSongId = nextPending[0].id;
            } else {
                currentSongId = null;
            }
        }
        broadcastState();
    });

    // 删除歌曲
    socket.on('remove_song', (id) => {
        const index = songs.findIndex(s => s.id === id);
        if (index === -1) return;
        const song = songs[index];
        if (song.status === 'singing') {
            socket.emit('error_msg', '正在唱的歌曲不能删除，请先标记唱完');
            return;
        }
        songs.splice(index, 1);
        if (currentSongId === song.id) currentSongId = null;
        broadcastState();
    });

    socket.on('ping', () => {});

    socket.on('disconnect', () => {
        userCount--;
        io.emit('user_count', userCount);
        console.log(`用户断开，当前人数: ${userCount}`);
    });
});

const PORT = 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`🎸 沙邮吉他社 · 草地音乐节点歌K歌系统`);
    console.log(`📍 本机访问: http://localhost:${PORT}`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`📱 局域网访问: http://${net.address}:${PORT}`);
            }
        }
    }
    console.log(`📝 代码设计：谷雨宸`);
    console.log(`🔐 主控密码：guyuchenzuishuai`);
});