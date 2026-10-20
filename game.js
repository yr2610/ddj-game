/* 大道塾 - 一人用の非公式落ち物ゲーム。外部の有料サービス・APIキーは不要。 */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const canvas = $('arena'), ctx = canvas.getContext('2d'), M = window.Matter;
    const ui = {
        score: $('score'), best: $('best'), next: $('nextBall'),
        rushFill: $('rushFill'), rushPct: $('rushPct'), rushMeter: $('rushMeter'),
        rushText: $('rushText'), strike: $('strikeBtn'), throw: $('throwBtn'),
        hint: $('hint'), overlay: $('overlay'), panel: $('overlayPanel'),
        alert: $('alert'), sound: $('soundBtn'), voice: $('voiceBtn')
    };
    if (!M) {
        ui.panel.innerHTML = '<h2>読み込みエラー</h2><p>物理演算ライブラリを取得できません。通信を確認して再読み込みしてください。</p><button class="primary-btn" onclick="location.reload()">再読み込み</button>';
        return;
    }
    const {Engine, Bodies, Body, Composite, Events, Query} = M;
    const W = 360, H = 480, FLOOR = 470, LEFT = 11, RIGHT = 349, DANGER = 103, SPAWN = 48;
    // 容器幅338px。空道の半径を旧・塾長の97pxへ、暫定最終段の大道塾を116pxへ縮小。
    // 半径は前半を小さく、後半を急激に大きくして終盤の圧迫感を強める。
    const TIERS = [
        {name:'突',r:16,fill:'#8ad5d3',edge:'#398f9c',points:10},
        {name:'蹴',r:22,fill:'#b7d88c',edge:'#6b9854',points:25},
        {name:'効果',r:30,fill:'#e0c879',edge:'#aa8f4b',points:60},
        {name:'投',r:40,fill:'#c9a9db',edge:'#88689e',points:110},
        {name:'技あり',r:51,fill:'#f5b27c',edge:'#bb7454',points:200},
        {name:'極',r:64,fill:'#e89a8e',edge:'#b85e61',points:340},
        {name:'一本',r:79,fill:'#96b7e5',edge:'#567eac',points:570},
        {name:'空道',r:97,fill:'#eac775',edge:'#a57d32',points:1600},
        {name:'大道塾',r:116,fill:'#e89b75',edge:'#aa5749',points:2600}
    ];
    const SHOUTS = ['セイッ！','ヤーッ！','エイヤッ！','オリャッ！','ドリャアッ！','トォッ！'];
    // スマホのWeb Speech APIは無音になり得るため、CC0の実録ボイスを使う。
    // HaelDB (CC0): https://opengameart.org/content/male-gruntyelling-sounds
    const MOBILE_VOICE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const VOICE_BASE = 'https://raw.githubusercontent.com/transitive-bullshit/ai-safety-doom/de99fce98d664c218944ec030859251f26c6bccf/public/game/audio/';
    const VOICE_FILES = ['player-pain-1.wav','player-pain-2.wav','player-death.wav'];
    const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
    const randomLevel = () => {const p=Math.random();return p<.48?0:p<.78?1:p<.95?2:3};
    let engine, balls=[], pending=[], particles=[], impacts=[];
    let mode='menu', score=0, best=0, gauge=0, nextLevel=0, pointerX=180;
    let currentTime=0, lastDrop=-5000, dangerSince=null, strikeEnds=0, throwEnds=0;
    let activePlacement=null, dropReady=true;
    let pointer=null, dragged=null, lastFrame=0, accumulator=0, shake=0, alertTimer=null;
    let muted=false, voiceEnabled=true, lastMergeVoice=-10000;
    try {best=Math.max(0,Number(localStorage.getItem('ddj-best-v1'))||0)} catch (_) {}
    ui.best.textContent=best.toLocaleString('ja-JP');

    const audio = {
        ctx:null, next:0, index:0,noiseBuffer:null,
        voiceBuffers:null,voiceLoadStarted:false,pendingVoice:null,voiceFailed:false,voiceIndex:0,
        async loadVoices() {
            if(this.voiceLoadStarted||!MOBILE_VOICE||!this.ctx)return;
            this.voiceLoadStarted=true;
            try {
                const buffers=[];
                for(const name of VOICE_FILES) {
                    const response=await fetch(VOICE_BASE+name,{mode:'cors'});
                    if(!response.ok)throw Error('HTTP '+response.status);
                    buffers.push(await this.ctx.decodeAudioData(await response.arrayBuffer()));
                }
                this.voiceBuffers=buffers;
                const waiting=this.pendingVoice;this.pendingVoice=null;
                if(waiting&&performance.now()-waiting.at<2000)this.sampleVoice(waiting.text);
            }catch (e) {
                this.voiceFailed=true;this.pendingVoice=null;
                console.warn('収録ボイスを取得できません:',e);
                ui.voice.textContent='声 読込失敗';
            }
        },
        sampleVoice(text) {
            if(muted||!voiceEnabled||!this.ctx)return;
            if(!this.voiceBuffers) {
                if(!this.voiceFailed)this.pendingVoice={text,at:performance.now()};
                return;
            }
            const long=/始め|そこまで|ドリャ|ラッシュ|一本/.test(text);
            const index=long?2:(this.voiceIndex++%2);
            const src=this.ctx.createBufferSource();
            const gain=this.ctx.createGain();
            src.buffer=this.voiceBuffers[index];
            src.playbackRate.value=long?1:0.92+Math.random()*.2;
            gain.gain.value=long?.35:.34;
            src.connect(gain);gain.connect(this.ctx.destination);src.start();
        },
        start() {
            const A=window.AudioContext||window.webkitAudioContext;
            if(!A)return;
            if(!this.ctx)this.ctx=new A();
            if(this.ctx.state==='suspended')this.ctx.resume().catch(()=>{});
            this.loadVoices();
            this.next=Math.max(this.next,this.ctx.currentTime+.02);
        },
        tone(freq,dur=.13,type='triangle',vol=.06,at,slide,attack=.009) {
            if(muted||!this.ctx)return;
            const a=this.ctx,t=at??a.currentTime,o=a.createOscillator(),g=a.createGain();
            o.type=type;o.frequency.setValueAtTime(Math.max(30,freq),t);
            if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,slide),t+dur);
            g.gain.setValueAtTime(.0001,t);
            g.gain.exponentialRampToValueAtTime(Math.max(.0002,vol),t+attack);
            g.gain.exponentialRampToValueAtTime(.0001,t+dur);
            o.connect(g);g.connect(a.destination);o.start(t);o.stop(t+dur+.02);
        },
        // 90年代の2D格闘ゲーム風：短い帯域ノイズ（皮の破裂音）と
        // 周波数が落ちる低音（打撃の胴鳴り）を重ねて作る。音声ファイル不要。
        burst(t,dur,freq,vol,type='bandpass') {
            if(!this.ctx||muted)return;
            const a=this.ctx;
            if(!this.noiseBuffer) {
                const length=Math.ceil(a.sampleRate*.24);
                this.noiseBuffer=a.createBuffer(1,length,a.sampleRate);
                const samples=this.noiseBuffer.getChannelData(0);
                for(let i=0;i<length;i++)samples[i]=(Math.random()*2-1)*(1-i/length*.25);
            }
            const source=a.createBufferSource(), filter=a.createBiquadFilter(), gain=a.createGain();
            source.buffer=this.noiseBuffer;
            filter.type=type;filter.frequency.value=freq;filter.Q.value=.8;
            gain.gain.setValueAtTime(Math.max(vol,.0001),t);
            gain.gain.exponentialRampToValueAtTime(.0001,t+dur);
            source.connect(filter);filter.connect(gain);gain.connect(a.destination);
            source.start(t);source.stop(t+dur);
        },
        impact(level=0,kind='merge') {
            if(!this.ctx||muted)return;
            const t=this.ctx.currentTime;
            const heavy=clamp(level/8,0,1);
            const strength=kind==='hit'?.72:kind==='break'?1.12:1;
            // 一瞬の「ピシッ」と、中域の「バシッ」、遅れて胴鳴り。
            // 低域だけでなくスマホの小型スピーカーで聞こえる中域を厚くする。
            this.burst(t,.024,3250,.36*strength,'highpass');
            this.burst(t+.003,.075,1350,.34*strength,'bandpass');
            this.burst(t+.012,.095+heavy*.033,680-heavy*180,.35*strength,'lowpass');
            this.tone(310-heavy*70,.043,'square',.055*strength,t,130-heavy*20,.001);
            this.tone(175-heavy*48,.10+heavy*.045,'sawtooth',.13*strength,t+.003,62-heavy*12,.002);
            this.tone(112-heavy*26,.14+heavy*.055,'triangle',.16*strength,t+.006,47,.002);
            if(level>=3||kind==='break') {
                // 大物の合体はわずかな二段打ちで重みを付ける。
                this.burst(t+.022,.068,920-heavy*130,.16*strength,'bandpass');
                this.tone(86-heavy*11,.13,'sawtooth',.057*strength,t+.02,43,.002);
            }
        },
        fx(name,level=0) {
            if(!this.ctx||muted)return;
            const t=this.ctx.currentTime;
            if(name==='drop')this.tone(160,.09,'triangle',.08,t,105);
            if(name==='merge')this.impact(level,'merge');
            if(name==='hit')this.impact(level,'hit');
            if(name==='break')this.impact(level,'break');
            if(name==='rush')[0,.1,.2].forEach((d,i)=>this.tone(300+i*120,.24,'sawtooth',.07,t+d));
            if(name==='end')[0,.17,.34].forEach((d,i)=>this.tone(320-i*60,.32,'triangle',.15,t+d));
        },
        music() {
            if(muted||!this.ctx||!['playing','strike','throw'].includes(mode)||this.ctx.state!=='running')return;
            const a=this.ctx,notes=[220,0,294,330,0,294,247,0,220,247,294,0,330,294,247,0];
            if(this.next<a.currentTime-.3)this.next=a.currentTime;
            let n=0;
            while(this.next<a.currentTime+.15&&n++<4) {
                const i=this.index++%16;
                if(i%4===0)this.tone(76,.12,'sine',.045,this.next,47);
                if(i%4===2)this.tone(195,.06,'triangle',.023,this.next,85);
                if(notes[i])this.tone(notes[i],.14,'triangle',mode==='strike'?.05:.027,this.next);
                this.next+=mode==='strike'?.17:.235;
            }
        }
    };
    // 日本語の音声一覧はAndroid等で遅延して届くため、voiceschangedでも更新する。
    let japaneseVoices=[];
    let currentUtterance=null;
    let speechDeadline=0;
    function refreshVoices() {
        if(!('speechSynthesis' in window))return;
        try {
            japaneseVoices=window.speechSynthesis.getVoices().filter(v=>/^ja(?:-|$)/i.test(v.lang||''));
        }catch (_) {}
    }
    function stopSpeech() {
        if('speechSynthesis' in window) {
            try {window.speechSynthesis.cancel()}catch (_) {}
        }
        currentUtterance=null;speechDeadline=0;
    }
    if('speechSynthesis' in window) {
        refreshVoices();
        if(window.speechSynthesis.addEventListener) {
            window.speechSynthesis.addEventListener('voiceschanged',refreshVoices);
        }
    }
    function speak(s,urgent=false) {
        if(muted||!voiceEnabled)return;
        if(MOBILE_VOICE) {audio.sampleVoice(s);return}
        if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;
        try {
            const a=window.speechSynthesis;
            const now=performance.now();
            // 毎回cancel()するとモバイル環境で無音になることがある。
            // 通常の掛け声はキューを溜めず間引き、重要な宣告だけ優先する。
            if(urgent)stopSpeech();
            else if(currentUtterance&&now<speechDeadline)return;
            else if(currentUtterance&&now>=speechDeadline)stopSpeech();
            if(!urgent&&(a.speaking||a.pending))return;
            refreshVoices();
            const u=new SpeechSynthesisUtterance(s);
            u.lang='ja-JP';u.rate=1.25;u.pitch=.8;u.volume=1;
            if(japaneseVoices.length)u.voice=japaneseVoices.find(v=>v.localService)||japaneseVoices[0];
            currentUtterance=u;
            speechDeadline=now+Math.min(3500,Math.max(1300,700+s.length*210));
            u.onend=()=>{if(currentUtterance===u){currentUtterance=null;speechDeadline=0}};
            u.onerror=e=>{
                if(currentUtterance===u){currentUtterance=null;speechDeadline=0}
                console.warn('音声合成に失敗しました:',e.error);
            };
            if(a.paused)a.resume();
            a.speak(u);
        }catch (e) {
            currentUtterance=null;speechDeadline=0;
            console.warn('音声合成が利用できません:',e);
        }
    }
    function hint(s){ui.hint.textContent=s}
    function notify(s,ms=850) {
        ui.alert.textContent=s;ui.alert.classList.add('active');
        if(alertTimer)clearTimeout(alertTimer);
        alertTimer=setTimeout(()=>ui.alert.classList.remove('active'),ms);
    }
    function points(n) {
        score+=n;
        if(score>best) {best=score;try{localStorage.setItem('ddj-best-v1',String(best))}catch(_){}}
        ui.score.textContent=score.toLocaleString('ja-JP');ui.best.textContent=best.toLocaleString('ja-JP');
    }
    // ゲージは「落とした玉の着地点が確定したとき」に一度だけ加算する。
    // フロアに着地しただけではほぼゼロ。積み上がりが高いほど急増し、
    // サイズの大きい玉ほど同じ高さでも増えやすくする。
    function placementGauge(b) {
        const supportHeight=clamp((FLOOR-(b.position.y+b.circleRadius))/(FLOOR-DANGER),0,1);
        const sizeFactor=3+b.game.level*1.1;
        return supportHeight*supportHeight*sizeFactor*1.4;
    }
    function addGauge(n) {gauge=clamp(gauge+n,0,100);updateHud()}
    function updatePlacement(dt) {
        if(mode!=='playing'||!activePlacement)return;
        const p=activePlacement,b=p.ball;
        if(!b||!b.game.alive) {
            // 最上位玉が消えた場合などは報酬なしで次の投下を許可。
            activePlacement=null;dropReady=true;hint('指で位置を決め、離すと玉を落とします');
            return;
        }
        const speed=Math.hypot(b.velocity.x,b.velocity.y);
        const spin=Math.abs(b.angularVelocity||0);
        // 通常の低速静止判定に加え、Y位置が一定なら横方向の転がりを許す。
        // 毎フレームの差分では遅い落下も誤検出するため、
        // 観測開始時の底面Yからの累積ずれで判定する。
        const bottom=b.position.y+b.circleRadius;
        if(p.heightAnchor===null||Math.abs(bottom-p.heightAnchor)>2.5){
            p.heightAnchor=bottom;p.heightStableMs=0;
        }else{
            p.heightStableMs+=dt;
        }
        p.stillMs=(speed<.85&&Math.abs(b.velocity.y)<.25&&spin<.055)?p.stillMs+dt:0;
        const elapsed=currentTime-p.since;
        const resting=(p.stillMs>=180||p.heightStableMs>=220);
        // 落下中の一瞬の頂点を静止扱いせず、転がり続けても3.2秒で解禁。
        if((elapsed>=460&&resting)||elapsed>=3200) {
            const earned=placementGauge(b);
            if(earned>0)addGauge(earned);
            activePlacement=null;dropReady=true;
            hint('指で位置を決め、離すと玉を落とします');
        }
    }
    function updateHud() {
        ui.rushPct.textContent=Math.floor(gauge)+'%';
        ui.rushFill.style.width=gauge+'%';
        ui.rushMeter.setAttribute('aria-valuenow',String(Math.floor(gauge)));
        ui.strike.disabled=mode!=='playing'||gauge<50||balls.length===0;
        ui.throw.disabled=mode!=='playing'||gauge<100||balls.length===0;
        ui.rushText.textContent=mode==='strike'?'打撃ラッシュ中！':
            mode==='throw'?'掴む玉を選べ！':gauge>=100?'打撃・投げ 解禁！':
            gauge>=50?'打撃 解禁！':'気合い充填中';
    }
    function updateNext() {
        const d=TIERS[nextLevel];
        ui.next.textContent=d.name;ui.next.style.background=d.fill;
        ui.next.style.fontSize=d.name.length>=3?'11px':d.name.length===2?'14px':'17px';
    }
    function spawnBall(level,x,y,velocity) {
        const d=TIERS[level],b=Bodies.circle(clamp(x,LEFT+d.r,RIGHT-d.r),y,d.r,{
            restitution:.055,friction:.88,frictionStatic:1.35,frictionAir:.008,density:.0012,slop:.015
        });
        b.game={level,alive:true,born:currentTime,hits:0,flash:0};
        if(velocity)Body.setVelocity(b,velocity);
        balls.push(b);Composite.add(engine.world,b);return b;
    }
    function removeBall(b) {
        if(!b?.game?.alive)return;
        b.game.alive=false;
        const i=balls.indexOf(b);if(i>=0)balls.splice(i,1);
        Composite.remove(engine.world,b);
    }
    function impactSpark(x,y,level,kind='merge') {
        const maxLife=kind==='merge'?(level>=4?20:16):11;
        impacts.push({x,y,level,kind,life:maxLife,maxLife,angle:Math.random()*Math.PI*2});
        if(impacts.length>32)impacts.splice(0,impacts.length-32);
    }
    function sparkle(x,y,color,n=10) {
        for(let i=0;i<n;i++){
            const a=Math.random()*Math.PI*2,v=1+Math.random()*3;
            particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-1,
                life:30+Math.random()*15,color,size:2+Math.random()*4});
        }
        if(particles.length>240)particles.splice(0,particles.length-240);
    }
    function makeWorld() {
        engine=Engine.create({enableSleeping:false});engine.gravity.y=1.3;
        engine.positionIterations=8;engine.velocityIterations=8;
        const wall={isStatic:true,friction:.9,frictionStatic:1.3,restitution:.03};
        Composite.add(engine.world,[
            Bodies.rectangle(1,H/2,20,H+150,wall),
            Bodies.rectangle(W-1,H/2,20,H+150,wall),
            Bodies.rectangle(W/2,H-1,W+70,20,wall)
        ]);
        Events.on(engine,'collisionStart',ev=>{
            for(const p of ev.pairs) {
                const a=p.bodyA,b=p.bodyB;
                if(a.game?.alive&&b.game?.alive&&a.game.level===b.game.level&&mode==='playing'&&a!==dragged&&b!==dragged)
                    pending.push([a,b]);
            }
        });
    }
    function merges() {
        const jobs=pending;pending=[];const used=new Set();
        for(const [a,b] of jobs) {
            if(!a.game.alive||!b.game.alive||used.has(a.id)||used.has(b.id))continue;
            if(a.game.level!==b.game.level)continue;
            used.add(a.id);used.add(b.id);
            const lv=a.game.level,x=(a.position.x+b.position.x)/2,y=(a.position.y+b.position.y)/2;
            const velocity={x:(a.velocity.x+b.velocity.x)/2,y:(a.velocity.y+b.velocity.y)/2-1};
            const tracked=activePlacement&&(activePlacement.ball===a||activePlacement.ball===b);
            removeBall(a);removeBall(b);
            const successor=lv<TIERS.length-1?spawnBall(lv+1,x,y,velocity):null;
            // 落下した玉が合体しても、後継の玉が静止するまで追いかける。
            if(tracked){
                activePlacement.ball=successor;activePlacement.stillMs=0;
                activePlacement.heightAnchor=null;activePlacement.heightStableMs=0;
            }
            points(TIERS[lv].points);
            sparkle(x,y,TIERS[lv].fill,14+lv*2);impactSpark(x,y,lv,'merge');audio.fx('merge',lv);
            if(lv>=2)shake=Math.max(shake,lv>=5?7:lv>=3?4:1.6);
            if(lv===1) {
                // 蹴＋蹴で「効果」完成。
                notify('効果！',650);
                if(currentTime-lastMergeVoice>900){speak('効果！',true);lastMergeVoice=currentTime}
            }else if(lv>=3) {
                notify(lv===TIERS.length-1?'完全制覇！！':lv>=5?'一本！！':'技あり！',900);
                if(currentTime-lastMergeVoice>900){speak(lv>=5?'一本！':'技あり！');lastMergeVoice=currentTime}
            }
        }
    }
    function reset() {
        stopSpeech()
        balls=[];pending=[];particles=[];impacts=[];score=0;gauge=0;nextLevel=randomLevel();
        activePlacement=null;dropReady=true;
        pointerX=W/2;pointer=null;dragged=null;dangerSince=null;
        currentTime=0;lastDrop=-5000;strikeEnds=0;throwEnds=0;lastMergeVoice=-10000;
        makeWorld();mode='playing';ui.score.textContent='0';ui.overlay.classList.add('hidden');
        updateNext();updateHud();hint('指で位置を決め、離すと玉を落とします');
        audio.start();audio.fx('rush');notify('始め！！',1000);speak('一本勝負！ 始め！',true);
    }
    function drop() {
        if(mode!=='playing'||!dropReady||currentTime-lastDrop<460)return;
        const droppedLevel=nextLevel;
        const b=spawnBall(droppedLevel,pointerX,SPAWN);
        lastDrop=currentTime;dropReady=false;
        activePlacement={ball:b,since:currentTime,stillMs:0,heightAnchor:null,heightStableMs:0};
        nextLevel=randomLevel();updateNext();
        hint('玉が落ち着くまで待機…');
        audio.fx('drop');speak(SHOUTS[Math.floor(Math.random()*SHOUTS.length)]);
    }
    function startStrike() {
        if(mode!=='playing'||gauge<50||!balls.length)return;
        gauge-=50;mode='strike';dangerSince=null;strikeEnds=currentTime+6000;
        audio.start();audio.fx('rush');speak('打撃ラッシュ！',true);
        notify('打撃ラッシュ！！',1200);hint('物理停止！ 6秒間、小さな玉を連打して破壊！');updateHud();
    }
    function startThrow() {
        if(mode!=='playing'||gauge<100||!balls.length)return;
        gauge-=100;mode='throw';dangerSince=null;throwEnds=currentTime+3000;
        pending=[]; // 投げ中に合体予約を持ち込まない
        audio.start();audio.fx('rush');speak('投げ！',true);
        notify('投げラッシュ！！',1200);hint('3秒間、何度でも玉を掴んで移動！');updateHud();
    }
    function queueTouchingPairs() {
        // 投げ中の接触はcollisionStartが発火済み。再開時に隣接ペアを拾い直す。
        for(let i=0;i<balls.length;i++) {
            for(let j=i+1;j<balls.length;j++){
                const a=balls[i],b=balls[j];
                if(!a.game.alive||!b.game.alive||a.game.level!==b.game.level)continue;
                const dx=a.position.x-b.position.x,dy=a.position.y-b.position.y;
                const d=a.circleRadius+b.circleRadius+2;
                if(dx*dx+dy*dy<=d*d)pending.push([a,b]);
            }
        }
    }
    function finishThrow() {
        if(mode!=='throw')return;
        if(dragged) {
            const b=dragged;dragged=null;
            Body.setStatic(b,false);Body.setVelocity(b,{x:0,y:0});
        }
        const heldPointer=pointer;pointer=null;
        if(heldPointer!==null&&canvas.hasPointerCapture(heldPointer))canvas.releasePointerCapture(heldPointer);
        mode='playing';dangerSince=null;
        queueTouchingPairs();audio.fx('hit');speak('ドリャアッ！',true);
        notify('投げ終了！！');hint('指で位置を決め、離すと玉を落とします');updateHud();
    }
    function pick(x,y) {
        return Query.point(balls,{x,y}).sort((a,b)=>
            Math.hypot(a.position.x-x,a.position.y-y)/a.circleRadius-
            Math.hypot(b.position.x-x,b.position.y-y)/b.circleRadius)[0]||null;
    }
    function hit(x,y) {
        const b=pick(x,y);if(!b)return;
        b.game.hits++;b.game.flash=14;sparkle(x,y,'#ffe2a8',8);impactSpark(x,y,b.game.level,'hit');shake=3;audio.fx('hit',b.game.level);
        if(b.game.hits>=2**b.game.level) {
            sparkle(b.position.x,b.position.y,'#d95a4b',16);impactSpark(b.position.x,b.position.y,b.game.level,'break');
            removeBall(b);audio.fx('break',b.game.level);points((b.game.level+1)*3);
        }
        updateHud();
    }
    function end() {
        if(mode==='ended')return;
        mode='ended';updateHud();audio.fx('end');speak('そこまで！',true);notify('そこまで！！',1350);
        const rank=score>=25000?'塾長級':score>=14000?'五段':score>=8000?'三段':
            score>=5000?'初段':score>=2500?'一級':score>=1000?'五級':'十級';
        ui.panel.innerHTML='<div class="panel-kicker">一本勝負・結果発表</div>'+
            '<h1 style="font-size:39px">そこまで！！</h1>'+
            '<div class="result">得点 <strong>'+score.toLocaleString('ja-JP')+
            '</strong><span class="result-small">ゲーム内段位認定</span><b>'+rank+'</b></div>'+
            '<button id="retryBtn" class="primary-btn">もう一本！ 始め！！</button>'+
            '<button id="shareBtn" class="share-btn">結果をLINEなどで共有</button>'+
            '<p class="panel-footnote">※ 段位はゲーム内のお遊び認定です。</p>';
        $('retryBtn').addEventListener('click',reset);
        $('shareBtn').addEventListener('click',()=>share(rank));
        setTimeout(()=>{if(mode==='ended')ui.overlay.classList.remove('hidden')},1250);
    }
    async function share(rank) {
        const msg='大道塾で '+score.toLocaleString('ja-JP')+'点！ '+rank+'認定！ セイッ！ ヤーッ！';
        const u=location.href.split('#')[0];
        try{
            if(navigator.share){await navigator.share({title:'大道塾',text:msg,url:u});return}
            if(navigator.clipboard?.writeText){
                await navigator.clipboard.writeText(msg+'\n'+u);$('shareBtn').textContent='コピーしました！';return
            }
            prompt('結果をコピーしてください',msg+'\n'+u);
        }catch(e){if(e.name!=='AbortError')prompt('結果をコピーしてください',msg+'\n'+u)}
    }
    function checkDanger() {
        if(mode!=='playing'){dangerSince=null;return}
        const threat=balls.some(b=>currentTime-b.game.born>1400&&
            b.position.y-b.circleRadius<DANGER&&
            (Math.hypot(b.velocity.x,b.velocity.y)<2.3||b.position.y<40));
        if(!threat){dangerSince=null;return}
        if(dangerSince===null)dangerSince=currentTime;
        if(currentTime-dangerSince>=2200)end();
    }
    function step(dt) {
        if(engine&&['playing','strike','throw'].includes(mode)){
            // 打撃中は時計だけ進めて物理演算・合体判定を完全停止する。
            currentTime+=dt;
            if(mode!=='strike')Engine.update(engine,dt);
            if(mode==='playing') {
                merges();
                updatePlacement(dt);
            }
            balls.forEach(b=>{if(b.game.flash>0)b.game.flash--});
            if(mode==='strike'&&currentTime>=strikeEnds) {
                mode='playing';notify('ラッシュ終了！');hint('指で位置を決め、離すと玉を落とします');updateHud();
            }
            if(mode==='throw'&&currentTime>=throwEnds)finishThrow();
            checkDanger();
        }
        particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=.07;p.life--});
        particles=particles.filter(p=>p.life>0);
        impacts.forEach(p=>p.life--);
        impacts=impacts.filter(p=>p.life>0);
        if(shake>0)shake*=.72;
    }
    function round(x,y,w,h,r) {ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
    function bg() {
        const g=ctx.createLinearGradient(0,0,W,H);
        g.addColorStop(0,'#f5e7cb');g.addColorStop(1,'#e5d0a9');
        ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
        ctx.strokeStyle='#d0b992';ctx.lineWidth=1;
        for(let x=45;x<W;x+=45){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,FLOOR);ctx.stroke()}
        ctx.save();ctx.globalAlpha=.075;ctx.fillStyle='#784c32';ctx.font='900 84px serif';ctx.textAlign='center';
        ctx.fillText('大',180,205);ctx.fillText('道',180,306);ctx.fillText('塾',180,407);ctx.restore();
        ctx.fillStyle='#c65b4410';ctx.fillRect(0,0,W,DANGER);
        ctx.setLineDash([9,7]);ctx.lineWidth=2.3;ctx.strokeStyle='#bc6957';
        ctx.beginPath();ctx.moveTo(0,DANGER);ctx.lineTo(W,DANGER);ctx.stroke();ctx.setLineDash([]);
        round(9,DANGER+7,78,21,4);ctx.fillStyle='#9e5146bf';ctx.fill();
        ctx.fillStyle='#fff1dd';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText('危険ライン',48,DANGER+22);
        ctx.fillStyle='#785738';ctx.fillRect(0,FLOOR,W,H-FLOOR);
    }
    function ballDraw(lv,x,y,r,flash=0,opacity=1,hits=0,angle=0) {
        const d=TIERS[lv];ctx.save();ctx.globalAlpha=opacity;ctx.translate(x,y);ctx.rotate(angle);
        ctx.shadowColor='#2b27233d';ctx.shadowBlur=7;ctx.shadowOffsetY=4;
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);
        const g=ctx.createRadialGradient(-r*.32,-r*.35,r*.1,0,0,r);
        g.addColorStop(0,flash>0?'#fff2b0':'#fff5ce');g.addColorStop(.3,d.fill);g.addColorStop(1,d.edge);
        ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
        ctx.strokeStyle='#344755';ctx.lineWidth=r>35?3:2;ctx.stroke();
        ctx.beginPath();ctx.arc(-r*.2,-r*.26,r*.48,Math.PI*1.1,Math.PI*1.62);
        ctx.strokeStyle='#ffffff72';ctx.lineWidth=Math.max(2,r*.08);ctx.stroke();
        ctx.fillStyle='#1d2b35';ctx.font=Math.min(r*1.20,lv>=7?38:40)+'px "Yuji Boku","Yu Mincho",serif';
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(d.name,0,1,r*1.75);
        if(hits){ctx.textBaseline='alphabetic';ctx.fillStyle='#a42923';ctx.font='900 10px system-ui';ctx.fillText(hits+'/'+(2**lv),0,r*.73)}
        ctx.restore();
    }
    // 「デュクシ！」に合わせた、短い白黄の8方向星型スパークと赤橙の衝撃線。
    // 全てCanvas描画なので追加の画像素材や通信は不要。
    function drawImpact(p) {
        const t=1-p.life/p.maxLife;
        const major=p.kind==='break'||p.level>=4;
        const size=(p.kind==='hit'?21:major?44:31)*(0.85+t*.7);
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle+t*.32);
        ctx.globalAlpha=Math.min(1,p.life/5);
        ctx.globalCompositeOperation='lighter';
        // 放射する細長い破片。周りの円からはみ出すことで打撃感を強調する。
        for(let i=0;i<8;i++) {
            const a=i*Math.PI/4;
            const start=size*(.43+t*.22),end=size*(1.22+t*.25);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a-.075)*start,Math.sin(a-.075)*start);
            ctx.lineTo(Math.cos(a)*end,Math.sin(a)*end);
            ctx.lineTo(Math.cos(a+.075)*start,Math.sin(a+.075)*start);
            ctx.closePath();ctx.fillStyle=i%2===0?'#fffce5':'#ffae38';ctx.fill();
        }
        for(const layer of [0,1]) {
            const inner=size*(layer?.09:.22),outer=size*(layer?.6:.93);
            ctx.beginPath();
            for(let i=0;i<16;i++) {
                const a=i*Math.PI/8,r=i%2?inner:outer;
                const x=Math.cos(a)*r,y=Math.sin(a)*r;
                if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
            }
            ctx.closePath();ctx.fillStyle=layer?'#fffef2':major?'#ff7930':'#ffd458';ctx.fill();
        }
        ctx.globalCompositeOperation='source-over';
        ctx.lineWidth=major?3:2;
        ctx.strokeStyle=major?'#b62f21':'#fff2c0';
        ctx.globalAlpha=(1-t)*.8;
        ctx.beginPath();ctx.arc(0,0,size*(.48+t*.75),0,Math.PI*2);ctx.stroke();
        ctx.restore();
    }
    function render() {
        ctx.save();if(shake>.25)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
        bg();
        balls.forEach(b=>ballDraw(b.game.level,b.position.x,b.position.y,b.circleRadius,b.game.flash,1,b.game.hits,b.angle));
        for(const p of particles){ctx.globalAlpha=clamp(p.life/42,0,1);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size)}
        ctx.globalAlpha=1;
        impacts.forEach(drawImpact);
        if(mode==='playing'){
            const d=TIERS[nextLevel],x=clamp(pointerX,LEFT+d.r,RIGHT-d.r);
            ctx.setLineDash([5,6]);ctx.strokeStyle='#4d6f7280';ctx.lineWidth=1.5;
            ctx.beginPath();ctx.moveTo(x,SPAWN+d.r);ctx.lineTo(x,FLOOR);ctx.stroke();ctx.setLineDash([]);
            ballDraw(nextLevel,x,SPAWN,d.r,0,.83);
        }
        if(mode==='strike') {
            const seconds=Math.max(0,(strikeEnds-currentTime)/1000);
            round(92,6,176,30,10);ctx.fillStyle='#b74e36e9';ctx.fill();
            ctx.fillStyle='#fff5cf';ctx.textAlign='center';ctx.font='900 18px system-ui';
            ctx.fillText('打撃！ 残り '+seconds.toFixed(1)+' 秒',180,27);
        }
        if(mode==='throw'){
            const seconds=Math.max(0,(throwEnds-currentTime)/1000);
            ctx.textAlign='center';ctx.font='900 19px system-ui';ctx.fillStyle='#366f88';
            ctx.fillText('投げ！ 残り '+seconds.toFixed(1)+' 秒',180,33);
            if(dragged){ctx.beginPath();ctx.arc(dragged.position.x,dragged.position.y,dragged.circleRadius+7,0,Math.PI*2);
                ctx.lineWidth=3;ctx.strokeStyle='#2699d3';ctx.stroke()}
        }
        if(dangerSince!==null&&mode==='playing'){
            ctx.fillStyle='#b93a2a';ctx.fillRect(0,0,W*clamp((currentTime-dangerSince)/2200,0,1),5);
        }
        ctx.restore();
    }
    function resize() {
        const d=Math.min(window.devicePixelRatio||1,2.5);
        canvas.width=Math.round(W*d);canvas.height=Math.round(H*d);
        ctx.setTransform(d,0,0,d,0,0);
    }
    function coord(e){
        const r=canvas.getBoundingClientRect();
        return {x:clamp((e.clientX-r.left)*W/r.width,0,W),y:clamp((e.clientY-r.top)*H/r.height,0,H)};
    }
    canvas.addEventListener('pointerdown',e=>{
        if(!['playing','strike','throw'].includes(mode)||pointer!==null)return;
        e.preventDefault();pointer=e.pointerId;canvas.setPointerCapture(e.pointerId);
        audio.start();const {x,y}=coord(e);pointerX=x;
        if(mode==='strike'){hit(x,y);return}
        if(mode==='throw'){
            const b=pick(x,y);
            if(b){dragged=b;Body.setStatic(b,true);Body.setVelocity(b,{x:0,y:0});
                Body.setPosition(b,{x:clamp(x,LEFT+b.circleRadius,RIGHT-b.circleRadius),
                    y:clamp(y,b.circleRadius+8,FLOOR-b.circleRadius)})}
        }
    });
    canvas.addEventListener('pointermove',e=>{
        if(pointer!==null&&e.pointerId!==pointer)return;
        const {x,y}=coord(e);pointerX=x;
        if(pointer!==null)e.preventDefault();
        if(mode==='throw'&&dragged&&pointer!==null){
            const r=dragged.circleRadius;
            Body.setPosition(dragged,{x:clamp(x,LEFT+r,RIGHT-r),y:clamp(y,r+9,FLOOR-r)});
        }
    });
    function release(e,canceled=false){
        if(e.pointerId!==pointer)return;
        if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
        pointer=null;
        if(mode==='throw'&&dragged){
            // 1回離しても投げラッシュは継続。時間切れまで掴み直せる。
            const b=dragged;dragged=null;Body.setStatic(b,false);Body.setVelocity(b,{x:0,y:0});
        }else if(mode==='playing'&&!canceled)drop();
    }
    canvas.addEventListener('pointerup',e=>{e.preventDefault();release(e)});
    canvas.addEventListener('pointercancel',e=>release(e,true));
    canvas.addEventListener('lostpointercapture',e=>{if(e.pointerId===pointer)release(e,true)});
    $('primaryBtn').addEventListener('click',reset);
    ui.strike.addEventListener('click',startStrike);
    ui.throw.addEventListener('click',startThrow);
    ui.sound.addEventListener('click',()=>{
        muted=!muted;if(muted)stopSpeech();
        if(!muted)audio.start();
        ui.sound.textContent=muted?'♫ OFF':'♫ ON';ui.sound.classList.toggle('off',muted);
    });
    ui.voice.addEventListener('click',()=>{
        voiceEnabled=!voiceEnabled;if(!voiceEnabled)stopSpeech();
        ui.voice.textContent=voiceEnabled?'声 ON':'声 OFF';ui.voice.classList.toggle('off',!voiceEnabled);
        if(voiceEnabled)speak('セイッ！',true);
    });
    document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();accumulator=0});
    function frame(ts){
        if(!lastFrame)lastFrame=ts;
        let dt=clamp(ts-lastFrame,0,45);lastFrame=ts;
        if(document.hidden)dt=0;
        accumulator+=dt;let n=0;
        while(accumulator>=1000/60&&n++<3){step(1000/60);accumulator-=1000/60}
        audio.music();render();requestAnimationFrame(frame);
    }
    resize();window.addEventListener('resize',resize);updateNext();updateHud();requestAnimationFrame(frame);
})();
