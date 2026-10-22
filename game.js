/* 大道塾 - 一人用の非公式落ち物ゲーム。外部の有料サービス・APIキーは不要。 */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const canvas = $('arena'), ctx = canvas.getContext('2d'), M = window.Matter;
    const ui = {
        score: $('score'), best: $('best'), next: $('nextBall'),
        strikeFill: $('strikeFill'), strikePct: $('strikePct'), strikeMeter: $('strikeMeter'),
        throwFill: $('throwFill'), throwPct: $('throwPct'), throwMeter: $('throwMeter'),
        strikeInfo: $('strikeInfo'), throwInfo: $('throwInfo'),
        strike: $('strikeBtn'), throw: $('throwBtn'),
        hint: $('hint'), overlay: $('overlay'), panel: $('overlayPanel'),
        alert: $('alert'), sound: $('soundBtn'), voice: $('voiceBtn')
    };
    if (!M) {
        ui.panel.innerHTML = '<h2>読み込みエラー</h2><p>物理演算ライブラリを取得できません。通信を確認して再読み込みしてください。</p><button class="primary-btn" onclick="location.reload()">再読み込み</button>';
        return;
    }
    const {Engine, Bodies, Body, Composite, Events, Query} = M;
    const W = 360, H = 525, FLOOR = 515, LEFT = 11, RIGHT = 349, DANGER = 96, SPAWN = 48;
    const DROP_COOLDOWN=500, SPECIAL_RECOVERY=700, DANGER_GRACE=6600;
    const STRIKE_TIME=9000, THROW_TIME=9000, RUSH_COUNTDOWN=3000;
    const RUSH_MIN=50, RUSH_MIN_TIME=3000, FULL_DAMAGE=1.25;
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
    // 合体して発生した特殊玉のみ9秒以内の連打で成立させる。
    // タイムアウト後の黒玉は打撃ラッシュ中に限り指定回数で除去可能。
    const SPECIAL = {
        2:{hits:4,blackHits:4,blackName:'注意'},
        4:{hits:8,blackHits:8,blackName:'警告'},
        6:{hits:16,blackHits:16,blackName:'失格'}
    };
    const SPECIAL_TIME=9000;
    const HIT_MARGIN=12; // 通常画面でも当てやすいよう玉の輪郭から12pxまで許容。
    const SHOUTS = ['セイッ！','ヤーッ！','エイヤッ！','オリャッ！','ドリャアッ！','トォッ！'];
    // スマホのWeb Speech APIは無音になり得るため、CC0の実録ボイスを使う。
    // HaelDB (CC0): https://opengameart.org/content/male-gruntyelling-sounds
    const MOBILE_VOICE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const VOICE_BASE = 'https://raw.githubusercontent.com/transitive-bullshit/ai-safety-doom/de99fce98d664c218944ec030859251f26c6bccf/public/game/audio/';
    const VOICE_FILES = ['player-pain-1.wav','player-pain-2.wav','player-death.wav'];
    const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
    const randomLevel = () => {const p=Math.random();return p<.48?0:p<.78?1:p<.95?2:3};
    let engine, balls=[], pending=[], particles=[], impacts=[];
    let mode='menu', score=0, best=0, throwGauge=0, strikeGauge=0, strikeDamage=1, nextLevel=0, pointerX=180;
    let currentTime=0, lastDrop=-5000, dropBlockedUntil=0, dangerSince=null, strikeEnds=0, throwEnds=0;
    let activePlacements=[], dropReady=true;
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
    function clearNotice() {
        if(alertTimer){clearTimeout(alertTimer);alertTimer=null}
        ui.alert.classList.remove('active');
        ui.alert.textContent='';
    }
    function notify(s,ms=850) {
        if(alertTimer){clearTimeout(alertTimer);alertTimer=null}
        ui.alert.textContent=s;ui.alert.classList.add('active');
        alertTimer=setTimeout(()=>{ui.alert.classList.remove('active');alertTimer=null},ms);
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
    // 高さによる従来の蓄積は投げ専用。
    function addGauge(n) {throwGauge=clamp(throwGauge+n,0,100);updateHud()}
    // 成立待ち玉への打撃だけで蓄積。遅くても少量、速いほど大きい。
    // 新規の玉の初打は2.5%。その後の同じ玉への打撃間隔で判定する。
    function chargeStrike(special){
        const elapsed=special.lastHitAt===null?null:currentTime-special.lastHitAt;
        special.lastHitAt=currentTime;
        const amount=elapsed===null?2.5:elapsed<=110?5:elapsed<=170?4.25:
            elapsed<=260?3.25:elapsed<=400?2.25:1.25;
        strikeGauge=clamp(strikeGauge+amount,0,100);
    }
    // 50%=3秒、75%=6秒、100%=9秒。最後の3秒だけ中央カウントダウンする。
    function rushDuration(charge,maxTime){
        return RUSH_MIN_TIME+(maxTime-RUSH_MIN_TIME)*clamp((charge-RUSH_MIN)/(100-RUSH_MIN),0,1);
    }
    function rushSeconds(charge,maxTime){return (rushDuration(charge,maxTime)/1000).toFixed(1)}
    // 次球の解禁は経過時間だけで決定する。着地や物理速度に依存しない。
    function updateDropCooldown(){
        if(mode==='playing'&&!dropReady&&currentTime-lastDrop>=DROP_COOLDOWN){
            dropReady=true;hint('盤面をタップして落下／成立待ち玉は連打');
        }
    }
    // ゲージは従来どおり「高さがほぼ停止した時」に確定する。
    // 連続して次を落としても、それぞれの玉の着地高さを追跡し続ける。
    function updatePlacements(dt) {
        if(mode!=='playing')return;
        for(let i=activePlacements.length-1;i>=0;i--){
            const p=activePlacements[i],b=p.ball;
            if(!b||!b.game.alive){activePlacements.splice(i,1);continue}
            const speed=Math.hypot(b.velocity.x,b.velocity.y);
            const spin=Math.abs(b.angularVelocity||0);
            const bottom=b.position.y+b.circleRadius;
            if(p.heightAnchor===null||Math.abs(bottom-p.heightAnchor)>2.5){
                p.heightAnchor=bottom;p.heightStableMs=0;
            }else{
                p.heightStableMs+=dt;
            }
            p.stillMs=(speed<.85&&Math.abs(b.velocity.y)<.25&&spin<.055)?p.stillMs+dt:0;
            const elapsed=currentTime-p.since;
            const resting=p.stillMs>=180||p.heightStableMs>=220;
            if((elapsed>=460&&resting)||elapsed>=3200){
                const earned=placementGauge(b);
                if(earned>0)addGauge(earned);
                activePlacements.splice(i,1);
            }
        }
    }
    function updateHud() {
        const strikeFull=strikeGauge>=100, throwFull=throwGauge>=100;
        ui.strikePct.textContent=Math.floor(strikeGauge)+'%';
        ui.throwPct.textContent=Math.floor(throwGauge)+'%';
        ui.strikeFill.style.width=strikeGauge+'%';
        ui.throwFill.style.width=throwGauge+'%';
        ui.strikeMeter.setAttribute('aria-valuenow',String(Math.floor(strikeGauge)));
        ui.throwMeter.setAttribute('aria-valuenow',String(Math.floor(throwGauge)));
        ui.strikeMeter.classList.toggle('full-charge',strikeFull);
        ui.throwMeter.classList.toggle('full-charge',throwFull);
        ui.strike.disabled=mode!=='playing'||strikeGauge<RUSH_MIN||balls.length===0;
        ui.throw.disabled=mode!=='playing'||throwGauge<RUSH_MIN||balls.length===0;
        ui.strikeInfo.textContent=strikeFull?'9秒・威力1.25倍':
            strikeGauge>=RUSH_MIN?rushSeconds(strikeGauge,STRIKE_TIME)+'秒':'50%で解禁';
        ui.throwInfo.textContent=throwFull?'9秒・黒玉全消去':
            throwGauge>=RUSH_MIN?rushSeconds(throwGauge,THROW_TIME)+'秒':'50%で解禁';
    }
    function updateNext() {
        const d=TIERS[nextLevel];
        ui.next.textContent=d.name;ui.next.style.background=d.fill;
        ui.next.style.fontSize=d.name.length>=3?'11px':d.name.length===2?'14px':'17px';
    }
    function canMerge(a,b) {
        return a.game?.alive&&b.game?.alive&&
            !a.game.special&&!b.game.special&&a.game.level===b.game.level;
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
    function enterSpecial(b,fromLevel) {
        const rule=SPECIAL[b.game.level];
        b.game.special={state:'pending',fromLevel,remaining:rule.hits,expires:currentTime+SPECIAL_TIME,lastHitAt:null};
        b.game.hits=0;
        notify(TIERS[b.game.level].name+'を叩け！',800);
    }
    function resolveSpecial(b) {
        const special=b.game.special;
        if(!special||special.state!=='pending')return;
        b.game.special=null;b.game.flash=16;
        // 技の成立後700msは「次の投下だけ」を禁止する。
        // 玉の物理、ほかの技への連打・タイマー、危険判定、ラッシュは継続する。
        dropBlockedUntil=Math.max(dropBlockedUntil,currentTime+SPECIAL_RECOVERY);
        // 成立前に別の指で開始された落下操作が、後から投下にならないよう破棄。
        // 投げラッシュのドラッグ操作には干渉しない。
        if(mode==='playing'&&pointer!==null){
            const id=pointer;pointer=null;
            if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
        }
        points(TIERS[special.fromLevel].points);
        const name=TIERS[b.game.level].name;
        notify(name+'！！',800);speak(name+'！',true);
        sparkle(b.position.x,b.position.y,'#fff3ba',18);
        impactSpark(b.position.x,b.position.y,b.game.level,'merge');
        // すでに触れていた同レベルの玉との合体を拾い直す。
        if(mode==='playing')queueTouchingPairs();
    }
    function expireSpecial(b) {
        const special=b.game.special;
        if(!special||special.state!=='pending')return;
        const rule=SPECIAL[b.game.level];
        special.state='black';special.remaining=rule.blackHits;
        special.expires=0;
        b.game.flash=10;
        sparkle(b.position.x,b.position.y,'#b85155',10);
        notify(rule.blackName+'！ 黒玉発生',850);
    }
    function updateSpecials() {
        for(const b of balls) {
            if(b.game.special?.state==='pending'&&currentTime>=b.game.special.expires)expireSpecial(b);
        }
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
                if(canMerge(a,b)&&mode==='playing'&&a!==dragged&&b!==dragged)
                    pending.push([a,b]);
            }
        });
    }
    function merges() {
        const jobs=pending;pending=[];const used=new Set();
        for(const [a,b] of jobs) {
            if(!a.game.alive||!b.game.alive||used.has(a.id)||used.has(b.id))continue;
            if(!canMerge(a,b))continue;
            used.add(a.id);used.add(b.id);
            const lv=a.game.level,x=(a.position.x+b.position.x)/2,y=(a.position.y+b.position.y)/2;
            const velocity={x:(a.velocity.x+b.velocity.x)/2,y:(a.velocity.y+b.velocity.y)/2-1};
            const tracked=activePlacements.filter(p=>p.ball===a||p.ball===b);
            removeBall(a);removeBall(b);
            const successor=lv<TIERS.length-1?spawnBall(lv+1,x,y,velocity):null;
            if(successor&&SPECIAL[successor.game.level])enterSpecial(successor,lv);
            // 合体で玉が変わっても、各投下分の高さ判定を継続する。
            if(tracked.length>1){
                // 2発の落下玉が合体したとき、同じ後継球のゲージを二重加算しない。
                for(const p of tracked.slice(1)){
                    const i=activePlacements.indexOf(p);
                    if(i>=0)activePlacements.splice(i,1);
                }
            }
            if(tracked.length){
                const p=tracked[0];
                p.ball=successor;p.stillMs=0;
                p.heightAnchor=null;p.heightStableMs=0;
            }
            if(!successor?.game.special)points(TIERS[lv].points);
            sparkle(x,y,TIERS[lv].fill,14+lv*2);impactSpark(x,y,lv,'merge');audio.fx('merge',lv);
            if(lv>=2)shake=Math.max(shake,lv>=5?7:lv>=3?4:1.6);
            if(lv===TIERS.length-1)notify('完全制覇！！',900);
        }
    }
    function reset() {
        stopSpeech()
        balls=[];pending=[];particles=[];impacts=[];score=0;throwGauge=0;strikeGauge=0;strikeDamage=1;nextLevel=randomLevel();
        activePlacements=[];dropReady=true;
        pointerX=W/2;pointer=null;dragged=null;dangerSince=null;
        currentTime=0;lastDrop=-5000;dropBlockedUntil=0;strikeEnds=0;throwEnds=0;lastMergeVoice=-10000;
        makeWorld();mode='playing';ui.score.textContent='0';ui.overlay.classList.add('hidden');
        updateNext();updateHud();hint('盤面をタップして落下／成立待ち玉は連打');
        audio.start();audio.fx('rush');notify('始め！！',1000);speak('一本勝負！ 始め！',true);
    }
    function drop() {
        if(mode!=='playing'||currentTime<dropBlockedUntil||!dropReady||currentTime-lastDrop<DROP_COOLDOWN)return;
        const droppedLevel=nextLevel;
        const b=spawnBall(droppedLevel,pointerX,SPAWN);
        lastDrop=currentTime;dropReady=false;
        activePlacements.push({ball:b,since:currentTime,stillMs:0,heightAnchor:null,heightStableMs:0});
        nextLevel=randomLevel();updateNext();
        hint('次の玉まで一瞬待機…');
        audio.fx('drop');speak(SHOUTS[Math.floor(Math.random()*SHOUTS.length)]);
    }
    // 途中まで削った耐久はラッシュ終了時に破棄する。成立待ちの技への
    // 連打進捗は別物なのでリセットしない。
    function resetRushDamage(){
        for(const b of balls){
            b.game.hits=0;
            if(b.game.special?.state==='black')
                b.game.special.remaining=SPECIAL[b.game.level].blackHits;
        }
        strikeDamage=1;
    }
    function startStrike() {
        if(mode!=='playing'||strikeGauge<RUSH_MIN||!balls.length)return;
        const charge=strikeGauge;
        strikeGauge=0;
        resetRushDamage(); // 必ず満タンから開始
        strikeDamage=charge>=100?FULL_DAMAGE:1;
        mode='strike';dangerSince=null;strikeEnds=currentTime+rushDuration(charge,STRIKE_TIME);
        audio.start();audio.fx('rush');speak('打撃ラッシュ！',true);
        notify(charge>=100?'全力打撃！！':'打撃ラッシュ！！',1200);
        hint('物理停止！ 残り時間は充填量に比例。玉を連打して処分！');updateHud();
    }
    function startThrow() {
        if(mode!=='playing'||throwGauge<RUSH_MIN||!balls.length)return;
        const charge=throwGauge;
        throwGauge=0;
        mode='throw';dangerSince=null;throwEnds=currentTime+rushDuration(charge,THROW_TIME);
        pending=[]; // 投げ中に合体予約を持ち込まない
        if(charge>=100){
            // MAXだけ、盤面内の黒玉を即時除去。得点や新規合体は発生させない。
            const blacks=balls.filter(b=>b.game.special?.state==='black');
            for(const b of blacks){
                sparkle(b.position.x,b.position.y,'#f3c976',12);
                impactSpark(b.position.x,b.position.y,b.game.level,'break');
                removeBall(b);
            }
        }
        audio.start();audio.fx('rush');speak('投げ！',true);
        notify(charge>=100?'黒玉一掃！！':'投げラッシュ！！',1200);
        hint(charge>=100?'黒玉全消去！ 9秒間、何度でも玉を掴んで移動！':
            '何度でも玉を掴んで移動！');updateHud();
    }
    function queueTouchingPairs() {
        // 投げ中の接触はcollisionStartが発火済み。再開時に隣接ペアを拾い直す。
        for(let i=0;i<balls.length;i++) {
            for(let j=i+1;j<balls.length;j++){
                const a=balls[i],b=balls[j];
                if(!canMerge(a,b))continue;
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
        notify('投げ終了！！');hint('盤面をタップして落下／成立待ち玉は連打');updateHud();
    }
    function pick(x,y,onlyPending=false,extra=0) {
        // タップ専用の判定のみ広げ、物理衝突や玉同士の合体判定は変更しない。
        const candidates=extra>0?
            balls.filter(b=>b.game.alive&&
                Math.hypot(b.position.x-x,b.position.y-y)<=b.circleRadius+extra):
            Query.point(balls,{x,y});
        const available=onlyPending?
            candidates.filter(b=>b.game.special?.state==='pending'):candidates;
        // 複数の許容範囲が重なっても最も近い玉を優先する。
        return available.sort((a,b)=>
            Math.hypot(a.position.x-x,a.position.y-y)/(a.circleRadius+extra)-
            Math.hypot(b.position.x-x,b.position.y-y)/(b.circleRadius+extra))[0]||null;
    }
    function hit(x,y) {
        const target=pick(x,y,mode!=='strike',HIT_MARGIN);
        if(!target)return false;
        const state=target.game.special?.state;
        // 通常時は「成立待ち」だけ叩ける。黒玉はラッシュ専用。
        if(mode!=='strike'&&state!=='pending')return false;
        const b=target;
        if(state==='pending'&&currentTime>=b.game.special.expires) {
            // タップ直前に期限切れとなった場合も、誤落下には変換しない。
            expireSpecial(b);return true;
        }
        b.game.flash=14;
        sparkle(x,y,'#ffe2a8',8);impactSpark(x,y,b.game.level,'hit');
        shake=3;audio.fx('hit',b.game.level);
        if(state==='pending') {
            chargeStrike(b.game.special);
            b.game.special.remaining--;
            if(b.game.special.remaining<=0)resolveSpecial(b);
        }else if(state==='black') {
            b.game.special.remaining-=strikeDamage;
            if(b.game.special.remaining<=0) {
                sparkle(b.position.x,b.position.y,'#d95a4b',16);
                impactSpark(b.position.x,b.position.y,b.game.level,'break');
                removeBall(b);audio.fx('break',b.game.level);
                points((b.game.level+1)*3);
            }
        }else {
            b.game.hits+=strikeDamage;
            if(b.game.hits>=2**b.game.level) {
                sparkle(b.position.x,b.position.y,'#d95a4b',16);
                impactSpark(b.position.x,b.position.y,b.game.level,'break');
                removeBall(b);audio.fx('break',b.game.level);
                points((b.game.level+1)*3);
            }
        }
        updateHud();return true;
    }
    function end() {
        if(mode==='ended')return;
        mode='ended';updateHud();audio.fx('end');speak('そこまで！',true);notify('そこまで！！',1350);
        const rank=score>=25000?'塾長級':score>=14000?'五段':score>=8000?'三段':
            score>=5000?'初段':score>=2500?'一級':score>=1000?'五級':'十級';
        ui.panel.innerHTML='<div class="panel-kicker">一本勝負・勝負あり</div>'+
            '<h1 class="result-headline">結果発表</h1>'+
            '<div class="result">得点 <strong>'+score.toLocaleString('ja-JP')+
            '</strong><span class="result-small">ゲーム内段位認定</span><b>'+rank+'</b></div>'+
            '<button id="retryBtn" class="primary-btn">もう一本！ 始め！！</button>'+
            '<button id="shareBtn" class="share-btn">結果をLINEなどで共有</button>'+
            '<p class="panel-footnote">※ 段位はゲーム内のお遊び認定です。</p>';
        $('retryBtn').addEventListener('click',reset);
        $('shareBtn').addEventListener('click',()=>share(rank));
        setTimeout(()=>{
            if(mode==='ended'){
                clearNotice(); // 「そこまで！」は一瞬の演出のみ。リザルトに持ち越さない。
                ui.overlay.classList.remove('hidden');
            }
        },1250);
    }
    async function share(rank) {
        const msg='大道塾で '+score.toLocaleString('ja-JP')+'点！ '+rank+'認定！ セイッ！ ヤーッ！';
        const u=location.href.split('#')[0];
        try{
            if(navigator.share){await navigator.share({title:'大道塾藝夢',text:msg,url:u});return}
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
        if(currentTime-dangerSince>=DANGER_GRACE)end();
    }
    function step(dt) {
        if(engine&&['playing','strike','throw'].includes(mode)){
            // 成立直後もゲーム時計・物理演算・連打タイマーは進める。
            currentTime+=dt;
            // 打撃ラッシュ中は時計だけ進めて物理演算・合体判定を完全停止する。
            if(mode!=='strike')Engine.update(engine,dt);
            updateSpecials();
            if(mode==='playing') {
                merges();
                updateDropCooldown();
                updatePlacements(dt);
            }
            balls.forEach(b=>{if(b.game.flash>0)b.game.flash--});
            if(mode==='strike'&&currentTime>=strikeEnds) {
                resetRushDamage();
                mode='playing';queueTouchingPairs();notify('ラッシュ終了！');hint('盤面をタップして落下／成立待ち玉は連打');updateHud();
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
    // 夕焼けの岩山と滝を一度読み込み、Canvas上へ描画。暗めの被せで玉を見やすくする。
    // 画像が読めない場合は単色の背景にフォールバック。
    const scenery=new window.Image();
    scenery.decoding='async';
    scenery.src='./assets/waterfall-sunset.webp?v=20261021-waterfall1';
    function bg(){
        ctx.fillStyle='#433444';ctx.fillRect(0,0,W,H);
        if(scenery.complete&&scenery.naturalWidth>0){
            ctx.drawImage(scenery,0,0,W,H);
            ctx.fillStyle='rgba(12,10,18,.34)';ctx.fillRect(0,0,W,H);
        }
        ctx.fillStyle='#bb222d26';ctx.fillRect(0,0,W,DANGER);
        ctx.setLineDash([9,7]);ctx.lineWidth=2.3;ctx.strokeStyle='#ffccaa';
        ctx.beginPath();ctx.moveTo(0,DANGER);ctx.lineTo(W,DANGER);ctx.stroke();ctx.setLineDash([]);
        round(9,DANGER+7,79,21,4);ctx.fillStyle='#6b1b2ae8';ctx.fill();
        ctx.fillStyle='#fff1dd';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText('危険ライン',48,DANGER+22);
        ctx.fillStyle='#2b2526b8';ctx.fillRect(0,FLOOR,W,H-FLOOR);
    }
    function ballDraw(lv,x,y,r,flash=0,opacity=1,hits=0,angle=0,black=false,pending=false) {
        const d=TIERS[lv];ctx.save();ctx.globalAlpha=opacity;ctx.translate(x,y);ctx.rotate(angle);
        ctx.shadowColor='#2b27233d';ctx.shadowBlur=7;ctx.shadowOffsetY=4;
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);
        const g=ctx.createRadialGradient(-r*.32,-r*.35,r*.1,0,0,r);
        g.addColorStop(0,black?(flash>0?'#9e4549':'#515158'):(flash>0?'#fff2b0':'#fff5ce'));
        g.addColorStop(.3,black?'#33343b':d.fill);g.addColorStop(1,black?'#16191e':d.edge);
        ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
        ctx.strokeStyle='#344755';ctx.lineWidth=r>35?3:2;ctx.stroke();
        ctx.beginPath();ctx.arc(-r*.2,-r*.26,r*.48,Math.PI*1.1,Math.PI*1.62);
        ctx.strokeStyle='#ffffff72';ctx.lineWidth=Math.max(2,r*.08);ctx.stroke();
        ctx.fillStyle=black?'#f4ebe1':'#1d2b35';
        const nameSize=pending?Math.min(r*.7,32):Math.min(r*1.20,lv>=7?38:40);
        ctx.font=nameSize+'px "Yuji Boku","Yu Mincho",serif';
        const name=black?SPECIAL[lv].blackName:d.name;
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(name,0,pending?-r*.28:black?-r*.11:1,r*1.75);
        if(hits&&!black){ctx.textBaseline='alphabetic';ctx.fillStyle='#a42923';ctx.font='900 10px system-ui';ctx.fillText(hits+'/'+(2**lv),0,r*.73)}
        ctx.restore();
    }
    // 「デュクシ！」に合わせた、短い白黄の8方向星型スパークと赤橙の衝撃線。
    // 全てCanvas描画なので追加の画像素材や通信は不要。
    // 90年代2D格闘の白い打撃スパーク。星形花火ではなく、白い芯と
    // 長さが不揃いの鋭い突起・淡い残像を瞬間的に表示する。
    function drawImpact(p) {
        const t=1-p.life/p.maxLife;
        const major=p.kind==='break'||p.level>=4;
        const size=(p.kind==='hit'?22:major?40:30)*(.91+t*.31);
        const alpha=clamp(p.life/6,0,1)*(t<.12?.65+t/.12*.35:1);
        const lengths=[1.25,.61,.98,.67,1.16,.55,.94,.7];
        ctx.save();ctx.translate(p.x,p.y);
        ctx.rotate(p.angle*.22+t*.11);
        ctx.scale(1,.87);
        ctx.globalCompositeOperation='lighter';
        // 芯の周囲だけ薄いにじみを追加。遠くに伸びるスパイクはシャープに。
        ctx.globalAlpha=alpha*.55;
        const glow=ctx.createRadialGradient(0,0,size*.08,0,0,size*.69);
        glow.addColorStop(0,'rgba(255,255,255,.9)');
        glow.addColorStop(.42,'rgba(240,244,249,.52)');
        glow.addColorStop(1,'rgba(220,228,237,0)');
        ctx.fillStyle=glow;
        ctx.beginPath();ctx.arc(0,0,size*.69,0,Math.PI*2);ctx.fill();
        // 鈍いグレーの外側と明るい白の内側を少しずらして重ねる。
        for(let layer=0;layer<2;layer++){
            // ベージュ背景でも白が埋もれないよう下層は通常合成の薄い灰色。
            ctx.globalCompositeOperation=layer?'lighter':'source-over';
            ctx.globalAlpha=alpha*(layer?1:.48);
            ctx.fillStyle=layer?'#fff':'#aeb8c3';
            ctx.beginPath();
            for(let i=0;i<8;i++){
                const angle=i*Math.PI/4;
                const inner=size*(layer?.11:.16);
                const tip=size*lengths[i]*(layer?.95:1.13);
                const halfWidth=layer?.19:.24;
                ctx.moveTo(Math.cos(angle-halfWidth)*inner,Math.sin(angle-halfWidth)*inner);
                ctx.lineTo(Math.cos(angle)*tip,Math.sin(angle)*tip);
                ctx.lineTo(Math.cos(angle+halfWidth)*inner,Math.sin(angle+halfWidth)*inner);
                ctx.closePath();
            }
            ctx.fill();
        }
        // 添付画像に近い、中心を横切る不規則な鋭い白の塊。
        ctx.globalAlpha=alpha;
        ctx.fillStyle='#fff';
        ctx.beginPath();
        const spikes=12;
        for(let i=0;i<spikes*2;i++){
            const a=i*Math.PI/spikes;
            const v=i%2?(.2+(i%3)*.025):(.46+(i%5)*.048);
            const r=size*v;
            const x=Math.cos(a)*r,y=Math.sin(a)*r;
            if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.closePath();ctx.fill();
        ctx.globalCompositeOperation='source-over';
        ctx.restore();
    }
    function drawSpecialOverlay(b) {
        const special=b.game.special;
        if(!special)return;
        const r=b.circleRadius,x=b.position.x,y=b.position.y;
        const pending=special.state==='pending';
        ctx.save();ctx.translate(x,y);ctx.textAlign='center';ctx.textBaseline='middle';
        if(pending) {
            const time=clamp((special.expires-currentTime)/SPECIAL_TIME,0,1);
            ctx.strokeStyle=time<.35?'#df3833':'#fff7db';
            ctx.lineWidth=4;ctx.beginPath();
            ctx.arc(0,0,r+2,-Math.PI/2,-Math.PI/2+Math.PI*2*time);ctx.stroke();
            ctx.fillStyle='#24292c';ctx.font='900 '+Math.min(22,r*.55)+'px system-ui';
            ctx.fillText(String(special.remaining),0,r*.42);
            const seconds=Math.ceil(Math.max(0,special.expires-currentTime)/1000);
            ctx.fillStyle='#a32b28';ctx.font='bold '+Math.max(11,Math.min(16,r*.28))+'px system-ui';
            ctx.fillText(seconds+'秒',0,-r*.78);
            // 「この玉を叩け！」を知らせる百裂拳風の高速脈動。
            // 玉の外側なので残り回数・秒数と重ならない。
            const phase=(currentTime%220)/220*Math.PI*2;
            const punch=(1+Math.sin(phase))*0.5;
            const side=x>W/2?-1:1;
            ctx.save();
            ctx.translate(side*(r+7-4*punch),-r*.6);
            ctx.scale(.80+.35*punch,.80+.35*punch);
            ctx.globalAlpha=.60+.40*punch;
            ctx.shadowColor='#f7e4af';ctx.shadowBlur=3+5*punch;
            ctx.font=Math.max(18,Math.min(25,r*.40))+'px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif';
            ctx.fillText('👊',0,0);
            ctx.restore();
        }else{
            ctx.strokeStyle='#dd4a3d';ctx.lineWidth=3;
            ctx.beginPath();ctx.arc(0,0,r-2,0,Math.PI*2);ctx.stroke();
            if(mode==='strike') {
                ctx.fillStyle='#fbe7a9';ctx.font='bold '+Math.min(22,r*.55)+'px system-ui';
                ctx.fillText('残'+Math.ceil(special.remaining),0,r*.46);
            }
        }
        ctx.restore();
    }
    // ラッシュの最後3秒だけ、中央に大きな数字を重ねる。
    // Canvasへの描画だけなので、玉への打撃や掴み操作の入力領域は変わらない。
    function drawRushCountdown(endTime,isThrow){
        const remain=(endTime-currentTime)/1000;
        if(remain<=0||remain>RUSH_COUNTDOWN/1000)return;
        const digit=Math.ceil(remain);
        const fractional=remain-(digit-1);
        const pop=1+.12*Math.max(0,1-(1-fractional)*4);
        const centerY=H*.49;
        ctx.save();
        ctx.translate(W/2,centerY);
        ctx.textAlign='center';ctx.textBaseline='middle';
        // 描画を半透明に抑え、背景の玉を見失わないようにする。
        ctx.fillStyle='rgba(11,10,18,.51)';
        round(-82,-90,164,27,5);ctx.fill();
        ctx.fillStyle=isThrow?'#c2f1ff':'#ffe7a9';
        ctx.font='900 15px system-ui';
        ctx.fillText('ラッシュ残り',0,-76);
        ctx.save();
        ctx.scale(pop,pop);
        ctx.globalAlpha=.82;
        ctx.font='1000 112px system-ui';
        ctx.lineWidth=8;ctx.lineJoin='round';
        ctx.strokeStyle='rgba(9,8,12,.8)';
        ctx.strokeText(String(digit),0,7);
        ctx.lineWidth=3;
        ctx.strokeStyle=isThrow?'#387e9e':'#aa382b';
        ctx.strokeText(String(digit),0,7);
        ctx.fillStyle=isThrow?'#d9f8ff':'#fff0bd';
        ctx.fillText(String(digit),0,7);
        ctx.restore();
        ctx.restore();
    }
    function render() {
        ctx.save();if(shake>.25)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
        bg();
        balls.forEach(b=>{
            const black=b.game.special?.state==='black';
            ballDraw(b.game.level,b.position.x,b.position.y,b.circleRadius,b.game.flash,1,Math.ceil(b.game.hits),b.angle,black,b.game.special?.state==='pending');
            drawSpecialOverlay(b);
        });
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
        if(mode==='strike')drawRushCountdown(strikeEnds,false);
        if(mode==='throw')drawRushCountdown(throwEnds,true);
        if(dangerSince!==null&&mode==='playing'){
            const progress=clamp((currentTime-dangerSince)/DANGER_GRACE,0,1);
            // 画面全体を赤く明滅させる。玉の判別は維持し、解除時に即停止する。
            const pulse=.5+.5*Math.sin(currentTime*Math.PI*2/430);
            ctx.fillStyle='rgba(222,14,21,'+(.065+.20*pulse)+')';
            ctx.fillRect(0,0,W,H);
            ctx.lineWidth=8+5*pulse;
            ctx.strokeStyle='rgba(255,65,48,'+(.40+.43*pulse)+')';
            ctx.strokeRect(3,3,W-6,H-6);
            ctx.fillStyle='#ff332e';
            ctx.fillRect(0,0,W*progress,6);
            // 危険の残り秒数を上部中央に表示（打撃ラッシュ中は消える）。
            ctx.fillStyle='#fff7e2';
            ctx.font='900 15px system-ui';
            ctx.textAlign='center';
            ctx.shadowColor='#1c090e';ctx.shadowBlur=4;
            ctx.fillText('危険！ 残り '+Math.ceil((DANGER_GRACE-(currentTime-dangerSince))/1000)+' 秒',W/2,19);
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
    // 盤面全体が落下エリア。ただし成立待ちの玉は、判定を12px広げて打撃を優先する。
    // pointerdownで打撃／落下を確定し、落下だけpointerupで発動する。
    // これにより素早い連打でも技へのタップが誤投下にならない。
    canvas.addEventListener('pointerdown',e=>{
        if(!['playing','strike','throw'].includes(mode))return;
        e.preventDefault();
        audio.start();
        const {x,y}=coord(e);
        if(mode==='strike'){hit(x,y);return}
        if(mode==='playing') {
            if(hit(x,y))return;
            // 別の技の連打は上のhitで先に処理する。落下操作だけ短時間無効。
            if(pointer!==null||!dropReady||currentTime<dropBlockedUntil)return;
            pointer=e.pointerId;
            canvas.setPointerCapture(e.pointerId);
            pointerX=x;
            return;
        }
        // 投げ中も成立待ち玉をタップしたら連打として扱う。
        if(pick(x,y,true,HIT_MARGIN)){hit(x,y);return}
        if(pointer!==null)return;
        pointer=e.pointerId;canvas.setPointerCapture(e.pointerId);
        const b=pick(x,y);
        if(b){
            dragged=b;Body.setStatic(b,true);Body.setVelocity(b,{x:0,y:0});
            Body.setPosition(b,{x:clamp(x,LEFT+b.circleRadius,RIGHT-b.circleRadius),
                y:clamp(y,b.circleRadius+8,FLOOR-b.circleRadius)});
        }
    });
    canvas.addEventListener('pointermove',e=>{
        if(pointer===null||e.pointerId!==pointer)return;
        e.preventDefault();
        const {x,y}=coord(e);
        if(mode==='playing'){
            // 空きスペースからドラッグしたときは着地点のプレビューを動かす。
            pointerX=x;
        }else if(mode==='throw'&&dragged){
            const r=dragged.circleRadius;
            Body.setPosition(dragged,{x:clamp(x,LEFT+r,RIGHT-r),y:clamp(y,r+9,FLOOR-r)});
        }
    });
    function release(e,canceled=false){
        if(e.pointerId!==pointer)return;
        pointer=null;
        if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
        if(mode==='throw'&&dragged){
            const b=dragged;dragged=null;
            Body.setStatic(b,false);Body.setVelocity(b,{x:0,y:0});
        }else if(mode==='playing'&&!canceled)drop();
    }
    canvas.addEventListener('pointerup',e=>{e.preventDefault();release(e)});
    canvas.addEventListener('pointercancel',e=>release(e,true));
    canvas.addEventListener('lostpointercapture',e=>{if(e.pointerId===pointer)release(e,true)});
    canvas.addEventListener('keydown',e=>{
        if(mode!=='playing')return;
        if(e.key==='ArrowLeft'||e.key==='ArrowRight') {
            e.preventDefault();
            pointerX=clamp(pointerX+(e.key==='ArrowLeft'?-15:15),0,W);
        }else if(e.key==='Enter'||e.key===' ') {
            e.preventDefault();audio.start();drop();
        }
    });
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
