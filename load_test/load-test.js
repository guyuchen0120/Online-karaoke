import http from 'k6/http';
import { check, sleep } from 'k6';

// ============================================================
// 测试配置
// ============================================================
export const options = {
    stages: [
        { duration: '10s', target: 3 },
        { duration: '20s', target: 5 },
        { duration: '20s', target: 5 },
        { duration: '10s', target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<5000'],
    },
};

// ============================================================
// 测试数据
// ============================================================
const SONGS = ['晴天', '七里香', '告白气球', '稻香', '夜曲', '小幸运', '那些年', '追光者', '起风了', '往后余生'];
const NAMES = ['小明', '小红', '小刚', '小丽', '小华', '张伟', '李娜', '王芳', '刘洋', '陈晨'];

function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// 主测试
// ============================================================
export default function () {
    const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
    const userName = randomItem(NAMES) + '_' + randomInt(100, 999);
    
    // 1. 访问首页
    const homeRes = http.get(`${baseUrl}/`);
    check(homeRes, {
        '✅ 首页加载': (r) => r.status === 200,
    });
    
    // 2. 轮询连接
    const pollRes = http.get(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`);
    check(pollRes, {
        '✅ 轮询连接': (r) => r.status === 200,
    });
    
    // 3. HTTP点歌（通过新接口）
    const song = randomItem(SONGS);
    const area = Math.random() > 0.5 ? 'song' : 'karaoke';
    
    const payload = JSON.stringify({
        title: song,
        singer: '压测歌手',
        requester: userName,
        area: area,
        remark: '压测点歌'
    });
    
    const addRes = http.post(
        `${baseUrl}/add-song`,
        payload,
        {
            headers: { 'Content-Type': 'application/json' },
            timeout: '5s'
        }
    );
    
    const success = check(addRes, {
        '✅ HTTP点歌': (r) => r.status === 200 && r.json('success') === true,
    });
    
    if (success) {
        console.log(`🎵 ${userName} 点歌成功: ${song}`);
    } else {
        console.log(`❌ ${userName} 点歌失败: ${addRes.body}`);
    }
    
    sleep(randomInt(1, 3));
    
    // 4. 再次轮询
    const pollRes2 = http.get(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`);
    check(pollRes2, {
        '✅ 二次轮询': (r) => r.status === 200,
    });
    
    // 5. 验证歌曲是否真的被添加
    const songsRes = http.get(`${baseUrl}/api/songs`);
    if (songsRes.status === 200) {
        const data = songsRes.json();
        console.log(`📊 当前歌曲总数: ${data.total}`);
    }
    
    sleep(randomInt(1, 3));
}