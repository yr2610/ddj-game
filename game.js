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
        rushPanel:$('rushPanel'), finalPanel:$('finalPanel'), finalFill:$('finalFill'),
        finalTime:$('finalTime'), finalKilled:$('finalKilled'),
        alert: $('alert'), sound: $('soundBtn'), voice: $('voiceBtn')
    };
    if (!M) {
        ui.panel.innerHTML = '<h2>読み込みエラー</h2><p>物理演算ライブラリを取得できません。通信を確認して再読み込みしてください。</p><button class="primary-btn" onclick="location.reload()">再読み込み</button>';
        return;
    }
    const {Engine, Bodies, Body, Composite, Events, Query} = M;
    const W = 360, H = 525, FLOOR = 515, LEFT = 11, RIGHT = 349, DANGER = 96, SPAWN = 48;
    const DROP_COOLDOWN=500, SPECIAL_RECOVERY=700, DANGER_GRACE=6600;
    const STRIKE_TIME=10000, THROW_TIME=10000, RUSH_COUNTDOWN=3000, RUSH_END_PAUSE=1100;
    const RUSH_MIN=30, RUSH_MIN_TIME=3000, FULL_DAMAGE=1.25;
    const STRIKE_CHARGE_MULTIPLIER=.125, THROW_CHARGE_MULTIPLIER=2;
    // 最終戦：24 + 2×12 + 8×6 + 32×1 = 128発、全43体
    const FINAL_STAGES=[
        {name:'大道塾',hp:24,r:100,children:2,bonus:8000},
        {name:'中道塾',hp:12,r:60,children:4,bonus:3000},
        // 後半ほど「倒せば延命できる」調整。連続撃破の条件は付けず、
        // 小さい玉を一個ずつ倒した分が確実に時間へ還元される。
        {name:'小道塾',hp:6,r:33,children:4,bonus:1800},
        {name:'ミニ道塾',hp:1,r:18,children:0,bonus:800}
    ];
    const FINAL_MAX_TIME=30000, FINAL_INTRO_TIME=2400;
    // スマホでの連打を想定した高難度調整。最終戦だけ全玉の移動速度と時計を2倍に。
    const FINAL_MOVE_MULTIPLIER=2, FINAL_TIME_DRAIN=2, FINAL_WARNING_TIME=7000;
    const FINAL_PREVIEW=/(?:^|&)final=1(?:&|$)/.test((location.search||'').replace(/^\?/,''));
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
    // iPadOSはMacintoshのUAを返すことがある。iPhone/iPadは共通の録音掛け声を使用。
    const IOS_AUDIO=/iPhone|iPad|iPod/i.test(navigator.userAgent)||
        (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const MOBILE_VOICE=/Android/i.test(navigator.userAgent)||IOS_AUDIO;
    const VOICE_BASE = 'https://raw.githubusercontent.com/transitive-bullshit/ai-safety-doom/de99fce98d664c218944ec030859251f26c6bccf/public/game/audio/';
    const VOICE_FILES = ['player-pain-1.wav','player-pain-2.wav','player-death.wav'];
    const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
    const randomLevel = () => {const p=Math.random();return p<.48?0:p<.78?1:p<.95?2:3};
    let engine, balls=[], pending=[], particles=[], impacts=[], successMarks=[];
    let mode='menu', score=0, best=0, throwGauge=0, strikeGauge=0, strikeDamage=1, nextLevel=0, pointerX=180;
    let currentTime=0, lastDrop=-5000, dropBlockedUntil=0, dangerSince=null, strikeEnds=0, throwEnds=0;
    let rushEndPauseMs=0, rushEndKind=null;
    let activePlacements=[], dropReady=true;
    let pointer=null, dragged=null, lastFrame=0, accumulator=0, shake=0, alertTimer=null;
    let rushReadyQueue=[];
    let finalIntroLeft=0, finalTimeLeft=FINAL_MAX_TIME, finalKills=0, finalHitMarks=[], finalGameActive=false;
    let muted=false, voiceEnabled=true, lastMergeVoice=-10000;
    try {best=Math.max(0,Number(localStorage.getItem('ddj-best-v1'))||0)} catch (_) {}
    ui.best.textContent=best.toLocaleString('ja-JP');

    const audio = {
        ctx:null, next:0, index:0,noiseBuffer:null,iosUnlocked:false,
        samples:{},sampleLoadStarted:false,sampleTurn:0,fxOutput:null,
        musicBuffers:{},musicLoadStarted:false,musicNode:null,musicName:null,
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
        // オリジナルPCMを優先。WAVは旧iOS Safariでも再生可能。
        // 取得失敗時のみ従来のKenney CC0 Ogg → 旧Web Audio合成音へ退避する。
        async loadSamples(){
            if(this.sampleLoadStarted||!this.ctx)return;
            this.sampleLoadStarted=true;
            const names=['hit-light','hit-alt','hit-heavy','hit-heavy2','break',
                'split','merge','finish','drop','rush','end','win'];
            const legacy=new Set(['hit-light','hit-alt','hit-heavy','hit-heavy2',
                'break','split','merge']);
            await Promise.all(names.map(async name=>{
                const formats=['wav',...(legacy.has(name)?['ogg']:[])];
                for(const ext of formats){
                    try{
                        const ver=ext==='wav'?'20261024-audio2':'arcade1';
                        const response=await fetch('./assets/audio/'+name+'.'+ext+'?v='+ver);
                        if(!response.ok)throw Error('HTTP '+response.status);
                        this.samples[name]=await this.ctx.decodeAudioData(await response.arrayBuffer());
                        return;
                    }catch(e){
                        if(ext===formats[formats.length-1])
                            console.warn('SEは合成音へ退避:',name,e);
                    }
                }
            }));
        },
        // 通常戦と最終戦を別アレンジした、ループ可能なオリジナルPCM BGM。
        // 読み込めなければ下の既存Web Audio BGMを維持する。
        async loadMusic(){
            if(this.musicLoadStarted||!this.ctx)return;
            this.musicLoadStarted=true;
            await Promise.all(['normal','final'].map(async name=>{
                try{
                    const response=await fetch('./assets/audio/music-'+name+'.wav?v=20261024-audio2');
                    if(!response.ok)throw Error('HTTP '+response.status);
                    this.musicBuffers[name]=await this.ctx.decodeAudioData(await response.arrayBuffer());
                }catch(e){
                    console.warn('PCM BGMを使用できません（合成BGMへ退避）:',name,e);
                }
            }));
        },
        syncMusic(name){
            if(this.musicName===name)return;
            const a=this.ctx, now=a.currentTime;
            if(this.musicNode){
                const old=this.musicNode;
                old.gain.gain.cancelScheduledValues(now);
                old.gain.gain.setValueAtTime(old.gain.gain.value,now);
                old.gain.gain.linearRampToValueAtTime(.0001,now+.16);
                try{old.source.stop(now+.18)}catch(_){}
                this.musicNode=null;
            }
            this.musicName=name;
            if(!name||!this.musicBuffers[name])return;
            const source=a.createBufferSource(),gain=a.createGain();
            source.buffer=this.musicBuffers[name];
            source.loop=true;
            gain.gain.setValueAtTime(.0001,now);
            gain.gain.linearRampToValueAtTime(name==='final'?.31:.36,now+.18);
            source.connect(gain);
            gain.connect(this.fxOutput||a.destination);
            source.start(now);
            this.musicNode={source,gain};
        },
        playSample(name,volume=.35,rate=1,time=null){
            const buffer=this.samples[name];
            if(muted||!this.ctx||!buffer||this.ctx.state!=='running')return false;
            try{
                const src=this.ctx.createBufferSource(),gain=this.ctx.createGain();
                src.buffer=buffer;
                src.playbackRate.value=rate;
                gain.gain.value=volume;
                src.connect(gain);gain.connect(this.fxOutput||this.ctx.destination);
                src.start(time??this.ctx.currentTime);
                return true;
            }catch(e){
                console.warn('効果音の再生に失敗しました:',name,e);
                return false;
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
        resume() {
            // iOS Safariはバックグラウンド復帰時に'suspended'だけでなく
            // 'interrupted'になる。どちらも再開対象にする。
            if(!this.ctx||this.ctx.state==='running'||this.ctx.state==='closed')return;
            try{
                const result=this.ctx.resume();
                if(result&&typeof result.catch==='function')
                    result.catch(e=>console.warn('音声再開に失敗しました:',e));
            }catch(e){console.warn('音声再開に失敗しました:',e)}
        },
        start() {
            const A=window.AudioContext||window.webkitAudioContext;
            if(!A)return;
            if(!this.ctx){
                // SafariのWeb Audioが消音スイッチに従い無音になるのを防ぐ。
                // AudioContext作成前にplaybackセッションを明示（対応iOSのみ）。
                if(IOS_AUDIO&&navigator.audioSession){
                    try{navigator.audioSession.type='playback'}catch(e){
                        console.warn('iOSオーディオセッション設定不可:',e);
                    }
                }
                try{this.ctx=new A()}catch(e){
                    console.warn('音声の初期化に失敗しました:',e);return;
                }
                // 高速連打で多数のPCMが重なった時のピークをソフトに抑える。
                if(this.ctx.createDynamicsCompressor){
                    const limiter=this.ctx.createDynamicsCompressor();
                    limiter.threshold.value=-15;
                    limiter.knee.value=9;
                    limiter.ratio.value=5;
                    limiter.attack.value=.003;
                    limiter.release.value=.16;
                    limiter.connect(this.ctx.destination);
                    this.fxOutput=limiter;
                }
            }
            this.resume();
            this.loadSamples();
            this.loadMusic();
            this.loadVoices();
            this.next=Math.max(this.next,this.ctx.currentTime+.02);
        },
        unlockIOS() {
            if(!IOS_AUDIO)return;
            this.start();
            if(!this.ctx||this.ctx.state==='closed')return;
            // Safariがユーザー操作と認めるtouchend/click中に
            // ごく短い無音バッファを再生してWeb Audioを起動する。
            // pointerdown(タッチ)だけでアンロック済みとは判定しない。
            if(!this.iosUnlocked||this.ctx.state!=='running'){
                try{
                    const src=this.ctx.createBufferSource();
                    src.buffer=this.ctx.createBuffer(1,1,this.ctx.sampleRate);
                    src.connect(this.ctx.destination);
                    src.start(0);
                    this.iosUnlocked=true;
                }catch(e){console.warn('iOS音声アンロックに失敗:',e)}
                this.resume();
            }
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
            // 90年代の格ゲー風：短く鋭いパンチと重い破砕音をPCMで再生。
            // 同じ音を連打しても毎回BufferSourceを作るので前の音を途切れさせない。
            const variation=1+(Math.random()-.5)*.08;
            if(name==='hit'){
                const heavy=level>=4,clip=heavy?
                    (this.sampleTurn++%2?'hit-heavy':'hit-heavy2'):
                    (this.sampleTurn++%2?'hit-light':'hit-alt');
                if(this.playSample(clip,heavy?.37:.32,variation))return;
            }
            if(name==='merge'){
                if(this.playSample('merge',.29,variation)){
                    if(level>=5)this.playSample('hit-heavy',.18,.91);
                    return;
                }
            }
            if(name==='break'){
                if(this.playSample('break',.38,variation)){
                    if(level>=5)this.playSample('hit-heavy',.24,.87);
                    return;
                }
            }
            if(name==='split'){
                if(this.playSample('split',.40,variation)){
                    this.playSample('hit-heavy2',.34,.9,t+.014);
                    return;
                }
            }
            if(name==='finish'){
                if(this.playSample('finish',.47,level>=6?.88:level>=4?1:1.08))return;
                if(this.playSample('hit-heavy',.40,.94))
                    this.playSample('merge',.23,1.05,t+.04);
                else this.impact(Math.max(4,level),'break');
                return;
            }
            if(name==='win'){
                if(this.playSample('win',.45))return;
                this.playSample('hit-heavy2',.42,.85);
                this.playSample('merge',.30,1.0,t+.045);
                // 勝利専用の短いファンファーレ。PC・スマホ共通。
                [57,60,64,69].forEach((note,i)=>{
                    const freq=440*Math.pow(2,(note-69)/12);
                    this.tone(freq,.22,'sawtooth',.058,t+i*.12,null,.005);
                });
                return;
            }
            if(name==='drop'&&this.playSample('drop',.32))return;
            if(name==='rush'&&this.playSample('rush',.47))return;
            if(name==='end'&&this.playSample('end',.48))return;
            if(name==='drop')this.tone(160,.09,'triangle',.08,t,105);
            if(name==='merge')this.impact(level,'merge');
            if(name==='hit')this.impact(level,'hit');
            if(name==='break')this.impact(level,'break');
            if(name==='split'){
                // ミニ破壊音より太く長い、二段に割れる格闘ヒット音。
                this.impact(Math.max(level,5),'break');
                this.burst(t+.012,.105,1450,.43,'bandpass');
                this.burst(t+.03,.16,560,.48,'lowpass');
                this.tone(225,.18,'sawtooth',.17,t+.01,55,.002);
                this.tone(385,.072,'square',.075,t+.024,150,.001);
            }
            if(name==='rush')[0,.1,.2].forEach((d,i)=>this.tone(300+i*120,.24,'sawtooth',.07,t+d));
            if(name==='end')[0,.17,.34].forEach((d,i)=>this.tone(320-i*60,.32,'triangle',.15,t+d));
        },
        music() {
            if(this.ctx&&this.musicBuffers.normal&&this.musicBuffers.final){
                const name=!muted&&this.ctx.state==='running'?
                    (mode==='final'?'final':
                        ['playing','strike','throw'].includes(mode)?'normal':null):null;
                this.syncMusic(name);
                return;
            }
            // 4小節の短調リフ。従来の16音単純ループを、ドラム・ベース・
            // 2声のブラス風スタブ・主旋律へ分離。最後の戦いはテンポアップ。
            if(muted||!this.ctx||!['playing','strike','throw','final'].includes(mode)||
                this.ctx.state!=='running')return;
            const a=this.ctx,fast=mode==='final'||mode==='strike';
            const step=(60/(fast?152:136))/4;
            const roots=[45,41,43,40]; // A / F / G / E
            const lead=[
                69,0,72,0,74,76,0,74,72,0,69,67,0,69,0,0,
                69,0,72,0,77,76,0,72,69,0,65,67,0,69,0,0,
                67,0,71,0,74,76,0,74,71,0,67,64,0,67,0,0,
                68,0,71,0,76,74,0,71,68,0,64,0,68,71,0,0
            ];
            const pitch=n=>440*Math.pow(2,(n-69)/12);
            if(this.next<a.currentTime-.25)this.next=a.currentTime+.02;
            let count=0;
            while(this.next<a.currentTime+.13&&count++<4) {
                const i=this.index++%64,bar=Math.floor(i/16),beat=i%16;
                const t=this.next,root=roots[bar];
                // キック4つ打ち・裏拍スネア・刻むハイハット。
                if(beat%4===0){
                    this.tone(92,.092,'sine',fast?.047:.039,t,43,.002);
                    this.tone(pitch(root),.21,'sawtooth',fast?.032:.026,t,null,.008);
                }
                if(beat%8===4){
                    this.burst(t,.065,1650,.038,'highpass');
                    this.tone(180,.045,'triangle',.016,t,92,.002);
                }
                if(beat%2===0)this.burst(t,.025,4800,fast?.013:.010,'highpass');
                // 小節頭と3拍目に短いコードスタブ。
                if(beat===0||beat===8){
                    for(const offset of [12,15,19])
                        this.tone(pitch(root+offset),.13,'sawtooth',fast?.013:.010,t,null,.006);
                }
                if(lead[i])this.tone(pitch(lead[i]),.17,fast?'sawtooth':'square',
                    fast?.022:.017,t,null,.005);
                this.next+=step;
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
        rushReadyQueue=[];
        ui.alert.classList.remove('active','end-call');
        ui.alert.textContent='';
    }
    // 技の成立宣告と同じ大きさ・同じ場所にラッシュ使用可能を通知する。
    // 技あり等の通知中にゲージが30%になっても上書きせず、宣告後に表示。
    function showNextRushReady(){
        if(!rushReadyQueue.length||mode==='menu'||mode==='ended')return;
        const type=rushReadyQueue.shift();
        if((type==='strike'?strikeGauge:throwGauge)<RUSH_MIN){
            showNextRushReady();
            return;
        }
        notify(type==='strike'?'打撃ラッシュOK！':'投げラッシュOK！',1150);
    }
    function queueRushReady(type){
        if(mode==='menu'||mode==='ended')return;
        rushReadyQueue.push(type);
        if(!alertTimer)showNextRushReady();
    }
    // ラッシュ解禁宣告は文字列が長いため、フィールドの実表示幅で収める。
    // 登場アニメーションは最大1.34倍になるので、その拡大時も左右に余白を確保。
    function fitRushReadyNotice(){
        const fieldWidth=canvas.getBoundingClientRect().width||W;
        const baseSize=Math.min(32,Math.max(12,fieldWidth*.088));
        ui.alert.style.fontSize=baseSize.toFixed(1)+'px';
        const textWidth=ui.alert.scrollWidth||baseSize*[...ui.alert.textContent].length;
        const allowedWidth=fieldWidth*.68;
        if(textWidth>allowedWidth)
            ui.alert.style.fontSize=(baseSize*allowedWidth/textWidth).toFixed(1)+'px';
    }
    // 「そこまで！」は盤面中央を使う大きな宣告。小さい画面では文字幅を実測して収める。
    function fitEndCallNotice(){
        const fieldWidth=canvas.getBoundingClientRect().width||W;
        const baseSize=Math.min(84,Math.max(40,fieldWidth*.21));
        ui.alert.style.fontSize=baseSize.toFixed(1)+'px';
        const textWidth=ui.alert.scrollWidth||baseSize*[...ui.alert.textContent].length;
        const allowedWidth=fieldWidth*.91;
        if(textWidth>allowedWidth)
            ui.alert.style.fontSize=(baseSize*allowedWidth/textWidth).toFixed(1)+'px';
    }
    function notify(s,ms=850) {
        if(alertTimer){clearTimeout(alertTimer);alertTimer=null}
        ui.alert.textContent=s;
        ui.alert.style.fontSize='';
        const endCall=/^そこまで[！!]+$/.test(s);
        ui.alert.classList.toggle('end-call',endCall);
        if(endCall)fitEndCallNotice();
        else if(/^(打撃|投げ)ラッシュOK！$/.test(s))fitRushReadyNotice();
        ui.alert.classList.add('active');
        alertTimer=setTimeout(()=>{
            ui.alert.classList.remove('active');
            alertTimer=null;
            // CSS演出を再始動するため、わずかに間を空けて次を表示。
            if(rushReadyQueue.length){
                alertTimer=setTimeout(()=>{
                    alertTimer=null;
                    showNextRushReady();
                },90);
            }
        },ms);
    }
    function points(n) {
        score+=n;
        if(!FINAL_PREVIEW&&score>best) {best=score;try{localStorage.setItem('ddj-best-v1',String(best))}catch(_){}}
        ui.score.textContent=score.toLocaleString('ja-JP');ui.best.textContent=best.toLocaleString('ja-JP');
    }
    // ゲージは「落とした玉の着地点が確定したとき」に一度だけ加算する。
    // フロアに着地しただけではほぼゼロ。積み上がりが高いほど急増し、
    // サイズの大きい玉ほど同じ高さでも増えやすくする。
    function placementGauge(b) {
        const supportHeight=clamp((FLOOR-(b.position.y+b.circleRadius))/(FLOOR-DANGER),0,1);
        const sizeFactor=3+b.game.level*1.1;
        return supportHeight*supportHeight*sizeFactor*1.4*THROW_CHARGE_MULTIPLIER;
    }
    // 高さによる従来の蓄積は投げ専用。
    function addGauge(n) {
        const before=throwGauge;
        throwGauge=clamp(throwGauge+n,0,100);
        updateHud();
        if(before<RUSH_MIN&&throwGauge>=RUSH_MIN)queueRushReady('throw');
    }
    // 成立待ち玉への打撃だけで蓄積。速いほど増加し、獲得量は旧版の1/4。
    // 基本値は初打2.5%、以降は同じ玉への打撃間隔で判定する。
    function chargeStrike(special){
        const elapsed=special.lastHitAt===null?null:currentTime-special.lastHitAt;
        special.lastHitAt=currentTime;
        const amount=elapsed===null?2.5:elapsed<=110?5:elapsed<=170?4.25:
            elapsed<=260?3.25:elapsed<=400?2.25:1.25;
        const before=strikeGauge;
        strikeGauge=clamp(strikeGauge+amount*STRIKE_CHARGE_MULTIPLIER,0,100);
        if(before<RUSH_MIN&&strikeGauge>=RUSH_MIN)queueRushReady('strike');
    }
    // 30%=3秒、50%=5秒、75%=7.5秒、100%=10秒。最後の3秒にカウントダウン。
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
        ui.strike.disabled=mode!=='playing'||rushEndPauseMs>0||strikeGauge<RUSH_MIN||balls.length===0;
        ui.throw.disabled=mode!=='playing'||rushEndPauseMs>0||throwGauge<RUSH_MIN||balls.length===0;
        ui.strikeInfo.textContent=strikeFull?'10秒・威力1.25倍':
            strikeGauge>=RUSH_MIN?rushSeconds(strikeGauge,STRIKE_TIME)+'秒':'30%で解禁';
        ui.throwInfo.textContent=throwFull?'10秒・黒玉全消去':
            throwGauge>=RUSH_MIN?rushSeconds(throwGauge,THROW_TIME)+'秒':'30%で解禁';
        if(mode==='final'||mode==='final-intro')updateFinalHud();
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

    // 最終戦は通常の合体・黒玉・ラッシュから独立した専用ボディ。
    function spawnFinalBall(stage,x,y,velocity){
        const def=FINAL_STAGES[stage],radius=def.r;
        const b=Bodies.circle(clamp(x,LEFT+radius,RIGHT-radius),clamp(y,radius+12,FLOOR-radius-1),radius,{
            // 壁・玉の接触で角速度が付くよう摩擦を有効化。
            restitution:.94,friction:.075,frictionStatic:.085,frictionAir:.001,density:.0006,slop:.025
        });
        b.game={finalStage:stage,hp:def.hp,alive:true,born:currentTime,flash:0,hits:0};
        const initial=velocity||{x:1.2,y:-.6};
        Body.setVelocity(b,{x:initial.x*FINAL_MOVE_MULTIPLIER,
            y:initial.y*FINAL_MOVE_MULTIPLIER});
        // 分裂直後から少し回り、衝突や打撃でも回転が変化する。
        Body.setAngularVelocity(b,(Math.random()-.5)*(stage>=2?.032:.022));
        balls.push(b);Composite.add(engine.world,b);
        return b;
    }
    const timeFlyLayer=$('timeFlyLayer');
    function clearTimeEnergy(){
        if(timeFlyLayer)timeFlyLayer.replaceChildren();
    }
    function flyTimeEnergy(x,y,recoveredMs,stage){
        // タイムゲージが実際に回復した場合のみ飛ばす。満タン時は誤認させない。
        if(recoveredMs<=0||!timeFlyLayer)return;
        const meter=ui.finalFill.parentElement;
        if(!meter)return;
        const arenaRect=canvas.getBoundingClientRect();
        const meterRect=meter.getBoundingClientRect();
        if(!arenaRect.width||!arenaRect.height||!meterRect.width)return;
        const sx=arenaRect.left+arenaRect.width*x/W;
        const sy=arenaRect.top+arenaRect.height*y/H;
        const filled=clamp(finalTimeLeft/FINAL_MAX_TIME,0,1);
        const ex=meterRect.left+2+(meterRect.width-4)*filled;
        const ey=meterRect.top+meterRect.height*.5;
        const dx=ex-sx,dy=ey-sy;
        // ボス分裂ほど光粒が多い。30fps相当の端末でも負荷を抑える。
        const count=stage===0?8:stage===1?6:stage===2?5:3;
        for(let i=0;i<count;i++){
            const spark=document.createElement('span');
            spark.className='time-energy'+(i===0?' time-energy--core':'');
            const spread=(i-(count-1)/2);
            const offsetX=spread*3.7;
            const offsetY=Math.sin(i*2.7)*5;
            spark.style.setProperty('--sx',(sx-6+offsetX)+'px');
            spark.style.setProperty('--sy',(sy-6+offsetY)+'px');
            spark.style.setProperty('--mx',(sx+dx*.44+spread*10-6)+'px');
            spark.style.setProperty('--my',(sy+dy*.41-38-Math.abs(spread)*8)+'px');
            spark.style.setProperty('--ex',(ex-5)+'px');
            spark.style.setProperty('--ey',(ey-5)+'px');
            spark.style.setProperty('--fly-delay',(i*29)+'ms');
            spark.style.setProperty('--fly-duration',(540+(i%3)*55)+'ms');
            timeFlyLayer.appendChild(spark);
            spark.addEventListener('animationend',()=>spark.remove(),{once:true});
            setTimeout(()=>spark.remove(),1100); // Safariでanimationendが来ない場合の保険
        }
        const label=document.createElement('span');
        label.className='time-bonus-label';
        label.textContent='+'+(recoveredMs/1000).toFixed(1)+'秒';
        label.style.setProperty('--lx',(sx+12)+'px');
        label.style.setProperty('--ly',(sy-29)+'px');
        timeFlyLayer.appendChild(label);
        label.addEventListener('animationend',()=>label.remove(),{once:true});
        setTimeout(()=>label.remove(),1100);
    }
    function updateFinalHud(){
        ui.finalTime.textContent=(finalTimeLeft/1000).toFixed(1)+'秒';
        ui.finalFill.style.width=(100*finalTimeLeft/FINAL_MAX_TIME)+'%';
        ui.finalKilled.textContent='撃破 '+finalKills+'/43';
        ui.finalPanel.classList.toggle('urgent',finalTimeLeft<=7000);
    }
    function showFinalHud(active){
        ui.rushPanel.style.display=active?'none':'';
        ui.finalPanel.style.display=active?'':'none';
        if(active){
            ui.next.textContent='拳';ui.next.style.background='#c75b3d';ui.next.style.fontSize='15px';
            updateFinalHud();
        }
    }
    function beginFinalBattle(){
        if(mode!=='playing')return;
        const old=[...balls];
        for(const b of old){
            sparkle(b.position.x,b.position.y,'#fff2cc',8);
            impactSpark(b.position.x,b.position.y,4,'hit');
            removeBall(b);
        }
        if(pointer!==null&&canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);
        pointer=null;dragged=null;pending=[];activePlacements=[];dangerSince=null;
        clearNotice();
        engine.gravity.y=0;
        Composite.add(engine.world,Bodies.rectangle(W/2,0,W+70,20,{
            isStatic:true,restitution:.98,friction:0
        }));
        clearTimeEnergy();
        successMarks=[];
        finalGameActive=true;finalIntroLeft=FINAL_INTRO_TIME;
        finalTimeLeft=FINAL_MAX_TIME;finalKills=0;finalHitMarks=[];
        spawnFinalBall(0,W/2,H*.53,{x:1.55,y:-.82});
        mode='final-intro';showFinalHud(true);updateHud();
        hint('最終戦！ 玉を叩いて全滅させろ！');
        audio.fx('rush');speak('最終戦！ 始め！',true);
    }
    function hitFinal(x,y){
        if(mode!=='final')return false;
        const targets=balls.filter(b=>b.game.alive&&
            Math.hypot(b.position.x-x,b.position.y-y)<=b.circleRadius+12);
        if(!targets.length)return false;
        targets.sort((a,b)=>Math.hypot(a.position.x-x,a.position.y-y)/
            (a.circleRadius+12)-Math.hypot(b.position.x-x,b.position.y-y)/(b.circleRadius+12));
        const b=targets[0],stage=b.game.finalStage,def=FINAL_STAGES[stage];
        b.game.hp--;b.game.flash=9;
        const dx=b.position.x-x,dy=b.position.y-y;
        const angle=Math.hypot(dx,dy)>2?Math.atan2(dy,dx):Math.random()*Math.PI*2;
        const push=(stage===0?1.85:stage===1?1.7:1.55)*FINAL_MOVE_MULTIPLIER;
        const speedLimit=(stage===0?4.1:stage===1?3.9:3.7)*FINAL_MOVE_MULTIPLIER;
        let nx=b.velocity.x*.55+Math.cos(angle)*push;
        let ny=b.velocity.y*.55+Math.sin(angle)*push;
        // 大玉が壁・天井・床へ押し付けられた場合は押し戻し、
        // コーナーで同じ場所を叩き続けられる状況を減らす。
        if(stage<=1){
            const margin=b.circleRadius+15;
            if((b.position.x<=LEFT+margin&&nx<0)||
               (b.position.x>=RIGHT-margin&&nx>0))nx=-nx*.9;
            if((b.position.y<=margin&&ny<0)||
               (b.position.y>=FLOOR-margin&&ny>0))ny=-ny*.9;
        }
        Body.setVelocity(b,{x:clamp(nx,-speedLimit,speedLimit),
            y:clamp(ny,-speedLimit,speedLimit)});
        const off=(x-b.position.x)/b.circleRadius;
        const spinKick=Math.abs(off)>.08?off*.022:(Math.random()<.5?-.009:.009);
        const spinMax=stage<=1?.035:.045;
        Body.setAngularVelocity(b,clamp((b.angularVelocity||0)*.75+spinKick,-spinMax,spinMax));
        impactSpark(x,y,stage>=2?2:5,'hit');audio.fx('hit',stage+2);
        if(b.game.hp>0)return true;
        const bx=b.position.x,by=b.position.y;
        removeBall(b);finalKills++;
        const timeBefore=finalTimeLeft;
        finalTimeLeft=Math.min(FINAL_MAX_TIME,finalTimeLeft+def.bonus);
        const recovered=finalTimeLeft-timeBefore;
        points(100*(stage+1));
        if(def.children){
            const child=FINAL_STAGES[stage+1];
            for(let i=0;i<def.children;i++){
                const theta=def.children===2?i*Math.PI:Math.PI/4+i*2*Math.PI/def.children;
                const distance=child.r*(def.children===2?1.35:1.5);
                const speed=stage===0?2.9:stage===1?3:3.5;
                spawnFinalBall(stage+1,bx+Math.cos(theta)*distance,
                    by+Math.sin(theta)*distance,{x:Math.cos(theta)*speed,y:Math.sin(theta)*speed});
            }
            // 分裂はミニ消滅より格段に大きなスパーク＋二段打撃音。
            sparkle(bx,by,'#fff0b6',stage===0?42:stage===1?32:24);
            impactSpark(bx,by,6-stage,'split');
            shake=Math.max(shake,stage===0?9:stage===1?6:4);
            finalHitMarks.push({x:bx,y:by,life:520,text:'バキィン！！',strong:true});
            audio.fx('split',6-stage);
        }else{
            sparkle(bx,by,'#fff3cc',16);impactSpark(bx,by,6,'break');
            finalHitMarks.push({x:bx,y:by,life:400,text:'バシュッ！',strong:false});
            audio.fx('break',stage+2);
        }
        if(finalHitMarks.length>18)finalHitMarks.splice(0,finalHitMarks.length-18);
        updateFinalHud();
        flyTimeEnergy(bx,by,recovered,stage);
        if(!balls.length)end('win');
        return true;
    }
    function drawFinalBall(b){
        const stage=b.game.finalStage,def=FINAL_STAGES[stage],radius=b.circleRadius;
        ctx.save();ctx.translate(b.position.x,b.position.y);
        // 開始演出は大道塾が一瞬膨張。物理半径・当たり判定は変更しない。
        const intro=clamp((FINAL_INTRO_TIME-finalIntroLeft)/FINAL_INTRO_TIME,0,1);
        if(mode==='final-intro'&&stage===0)ctx.scale(1+.16*Math.sin(Math.PI*intro),1+.16*Math.sin(Math.PI*intro));
        // 通常のボールと同様、玉の回転角へ筆文字も追従させる。
        ctx.rotate(b.angle);
        if(hasFinalBallArt()){
            drawFinalBallAsset(FINAL_FIGHT_ART[stage],radius);
            if(b.game.flash>0){
                ctx.beginPath();ctx.arc(0,0,radius-1,0,Math.PI*2);
                ctx.fillStyle='rgba(255,242,169,.22)';ctx.fill();
            }
            if(stage<3){
                // HPは既存のルール。筆文字に埋もれないよう輪郭を付ける。
                ctx.font='900 '+(stage===2?11:16)+'px system-ui';
                ctx.textAlign='center';ctx.textBaseline='middle';
                ctx.lineWidth=3;ctx.strokeStyle='#2b1014';
                ctx.fillStyle='#fff0c9';
                const remaining='残'+b.game.hp;
                ctx.strokeText(remaining,0,radius*.59);
                ctx.fillText(remaining,0,radius*.59);
            }
            ctx.restore();return;
        }
        ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);
        const gradient=ctx.createRadialGradient(-radius*.36,-radius*.4,radius*.1,0,0,radius);
        gradient.addColorStop(0,b.game.flash?'#fff8d5':'#fdf0cf');
        gradient.addColorStop(.48,stage===0?'#de8a60':stage===1?'#e1ba80':
            stage===2?'#d2b7dd':'#b6e4e6');
        gradient.addColorStop(1,stage===0?'#873930':stage===1?'#987044':
            stage===2?'#745887':'#447a8c');
        ctx.fillStyle=gradient;ctx.fill();
        ctx.lineWidth=stage>=2?2:3;ctx.strokeStyle='#5e393b';ctx.stroke();
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#29202a';
        // ボスの大道塾はサイズに見合う大きな筆文字。中道塾も少し拡大。
        // 円から文字がはみ出さないよう横幅には従来の上限を適用。
        const finalNameSize=stage===0?Math.min(radius*.62,65):
            stage===1?Math.min(radius*.6,40):stage===2?20:12;
        ctx.font=finalNameSize+'px "Yuji Boku","Yu Mincho",serif';
        if(stage===3){
            // 小さな玉でも名前が分かるよう、「ミニ道塾」を二段組で全文表示。
            ctx.fillText('ミニ',0,-radius*.33,radius*1.72);
            ctx.fillText('道塾',0,radius*.36,radius*1.72);
        }else{
            ctx.fillText(def.name,0,-radius*.13,radius*1.8);
        }
        if(stage<3){
            ctx.font='bold '+(stage===2?10:16)+'px system-ui';
            ctx.fillStyle='#612125';ctx.fillText('残'+b.game.hp,0,radius*.46);
        }
        ctx.restore();
    }
    function drawFinalOverlay(){
        ctx.save();
        if(mode==='final'&&finalTimeLeft<=FINAL_WARNING_TIME){
            // 画面全体の赤明滅。残り7秒で開始し、0秒に向けて激しくなる。
            // 玉へのタップ判定は変えず、先に描画して時間表示の可読性も保つ。
            const urgency=clamp(1-finalTimeLeft/FINAL_WARNING_TIME,0,1);
            const pulse=(1+Math.sin(currentTime*Math.PI*2/330))*.5;
            ctx.fillStyle='rgba(240,16,25,'+(.06+(.14+.20*urgency)*pulse)+')';
            ctx.fillRect(0,0,W,H);
            ctx.strokeStyle='rgba(255,78,59,'+(.33+.45*pulse)+')';
            ctx.lineWidth=6+4*pulse;
            ctx.strokeRect(3,3,W-6,H-6);
        }
        if(mode==='final'||mode==='final-intro'){
            const ratio=clamp(finalTimeLeft/FINAL_MAX_TIME,0,1);
            round(18,12,W-36,15,7);ctx.fillStyle='#171923';ctx.fill();
            round(20,14,(W-40)*ratio,11,5);
            ctx.fillStyle=ratio<.25?'#ed333d':'#efb552';ctx.fill();
            ctx.fillStyle='#fff2d9';ctx.font='900 15px system-ui';ctx.textAlign='center';
            ctx.fillText('残り '+(finalTimeLeft/1000).toFixed(1)+'秒',W/2,48);
        }
        for(const mark of finalHitMarks){
            ctx.globalAlpha=clamp(mark.life/300,0,1);
            ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.font='900 '+(mark.strong?25:19)+'px "Yuji Boku","Yu Mincho",serif';
            ctx.lineWidth=mark.strong?6:4;
            ctx.strokeStyle='#552029';ctx.strokeText(mark.text,mark.x,mark.y,W-30);
            ctx.fillStyle='#fff4d0';ctx.fillText(mark.text,mark.x,mark.y,W-30);
        }
        ctx.globalAlpha=1;
        if(mode==='final-intro'||(mode==='ended'&&finalIntroLeft<0)){
            ctx.fillStyle=mode==='final-intro'?'rgba(8,8,16,.48)':'rgba(8,8,16,.72)';
            ctx.fillRect(0,0,W,H);
            ctx.textAlign='center';ctx.textBaseline='middle';
            const result=mode==='ended';
            const line=result?(finalIntroLeft===-1500?'免許皆伝！！':'時間切れ！'):
                finalIntroLeft>FINAL_INTRO_TIME/2?'最終戦':'連打ぁ！！';
            ctx.lineWidth=8;ctx.lineJoin='round';
            ctx.font=(result?'bold 49px':'900 70px')+' "Yuji Boku","Yu Mincho",serif';
            ctx.strokeStyle='#52212d';ctx.strokeText(line,W/2,H*.45,W-36);
            ctx.fillStyle='#f4ca78';ctx.fillText(line,W/2,H*.45,W-36);
            if(!result){
                ctx.font='bold 23px "Yuji Boku","Yu Mincho",serif';
                ctx.fillStyle='#fff2d7';ctx.fillText('叩けぇ！',W/2,H*.61);
            }
        }
        ctx.restore();
    }
    function impactSpark(x,y,level,kind='merge') {
        const maxLife=kind==='split'?25:kind==='merge'?(level>=4?20:16):11;
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
        // 成立宣告は画面上部の固定通知を使わず、成立した玉の少し上へ表示する。
        // 連打指示がまだ出ていた場合のみ消し、ラッシュOK通知の待ち行列は残す。
        if(ui.alert.textContent===name+'を叩け！'){
            if(alertTimer){clearTimeout(alertTimer);alertTimer=null}
            ui.alert.classList.remove('active');
            ui.alert.textContent='';
            if(rushReadyQueue.length)showNextRushReady();
        }
        successMarks.push({
            x:b.position.x,y:b.position.y-b.circleRadius-12,
            text:name+(b.game.level===2?'！':b.game.level===4?'！！':'！！！'),
            level:b.game.level,life:950,maxLife:950
        });
        if(successMarks.length>9)successMarks.splice(0,successMarks.length-9);
        speak(name+'！',true);
        audio.fx('finish',b.game.level);
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
        // 黒玉になった瞬間、当該玉の近くへ大きな宣告を表示。
        // 固定HUDでなく成立の筆文字と同じ描画レイヤーを利用する。
        successMarks.push({
            x:b.position.x,y:b.position.y-b.circleRadius-12,
            text:rule.blackName+'！',level:b.game.level,
            black:true,life:1150,maxLife:1150
        });
        if(successMarks.length>9)successMarks.splice(0,successMarks.length-9);
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
            if(successor?.game.level===TIERS.length-1){
                beginFinalBattle();
                break;
            }
        }
    }
    function reset() {
        stopSpeech()
        clearTimeEnergy();
        clearNotice();
        balls=[];pending=[];particles=[];impacts=[];successMarks=[];score=0;throwGauge=0;strikeGauge=0;strikeDamage=1;nextLevel=randomLevel();
        activePlacements=[];dropReady=true;
        pointerX=W/2;pointer=null;dragged=null;dangerSince=null;
        currentTime=0;lastDrop=-5000;dropBlockedUntil=0;strikeEnds=0;throwEnds=0;lastMergeVoice=-10000;
        rushEndPauseMs=0;rushEndKind=null;
        finalIntroLeft=0;finalTimeLeft=FINAL_MAX_TIME;finalKills=0;finalHitMarks=[];finalGameActive=false;
        makeWorld();mode='playing';ui.score.textContent='0';ui.overlay.classList.add('hidden');
        showFinalHud(false);updateNext();updateHud();hint('盤面をタップして落下／成立待ち玉は連打');
        audio.start();audio.fx('rush');notify('始め！！',1000);speak('一本勝負！ 始め！',true);
        if(FINAL_PREVIEW)beginFinalBattle();
    }
    function drop() {
        if(mode!=='playing'||rushEndPauseMs>0||currentTime<dropBlockedUntil||!dropReady||currentTime-lastDrop<DROP_COOLDOWN)return;
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
        if(mode!=='playing'||rushEndPauseMs>0||strikeGauge<RUSH_MIN||!balls.length)return;
        rushReadyQueue=rushReadyQueue.filter(type=>type!=='strike');
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
        if(mode!=='playing'||rushEndPauseMs>0||throwGauge<RUSH_MIN||!balls.length)return;
        rushReadyQueue=rushReadyQueue.filter(type=>type!=='throw');
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
        hint(charge>=100?'黒玉全消去！ 10秒間、何度でも玉を掴んで移動！':
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
    function startRushEnd(kind){
        rushEndKind=kind;
        rushEndPauseMs=RUSH_END_PAUSE;
        clearNotice();
        hint('ラッシュ終了！ 一時停止中…');
        updateHud();
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
        startRushEnd('throw');
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
        if(rushEndPauseMs>0)return false;
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
    function end(finalOutcome=null) {
        if(mode==='ended')return;
        if(finalOutcome){
            clearNotice();mode='ended';updateHud();
            const victory=finalOutcome==='win';
            audio.fx(victory?'win':'end');
            speak(victory?'一本！':'そこまで！',true);
            ui.panel.innerHTML='<div class="panel-kicker">最終戦・'+(victory?'完全制覇':'時間切れ')+'</div>'+
                '<h1 class="result-headline">'+(victory?'免許皆伝！！':'時間切れ！')+'</h1>'+
                '<div class="result">得点 <strong>'+score.toLocaleString('ja-JP')+
                '</strong><span class="result-small">'+(victory?'大道塾藝夢 完全制覇':'最終戦 敗北')+'</span>'+
                '<b>'+(victory?'免許皆伝':'再挑戦！')+'</b></div>'+
                '<button id="retryBtn" class="primary-btn">もう一本！ 始め！！</button>'+
                '<button id="shareBtn" class="share-btn">結果をLINEなどで共有</button>';
            $('retryBtn').addEventListener('click',reset);
            $('shareBtn').addEventListener('click',()=>share(victory?'免許皆伝':'最終戦 敗北'));
            finalIntroLeft=victory?-1500:-900;
            setTimeout(()=>{if(mode==='ended'&&finalGameActive){
                finalIntroLeft=0;ui.overlay.classList.remove('hidden');
            }},1450);
            return;
        }
        mode='ended';updateHud();audio.fx('end');speak('そこまで！',true);notify('そこまで！',1650);
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
        },1720);
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
        if(mode==='final-intro'){
            finalIntroLeft=Math.max(0,finalIntroLeft-dt);
            if(finalIntroLeft===0){
                mode='final';hint('叩けぇ！ 分裂した玉も全滅させろ！');updateHud();
            }
            return;
        }
        if(mode==='final'){
            currentTime+=dt;
            finalTimeLeft=Math.max(0,finalTimeLeft-dt*FINAL_TIME_DRAIN);
            Engine.update(engine,dt);
            for(const b of balls){
                const vel=b.velocity,speed=Math.hypot(vel.x,vel.y);
                const stage=b.game.finalStage;
                const minSpeed=(stage===0?1.25:stage===1?1.4:.75)*FINAL_MOVE_MULTIPLIER;
                if(speed<minSpeed){
                    const angle=Math.atan2(b.position.y-H/2,b.position.x-W/2)+.5;
                    const restored=(stage===0?1.55:stage===1?1.8:1.15)*FINAL_MOVE_MULTIPLIER;
                    Body.setVelocity(b,{x:Math.cos(angle)*restored,y:Math.sin(angle)*restored});
                }
                const maxSpin=stage<=1?.035:.045;
                if(Math.abs(b.angularVelocity)>maxSpin)
                    Body.setAngularVelocity(b,clamp(b.angularVelocity,-maxSpin,maxSpin));
                if(b.game.flash>0)b.game.flash--;
            }
            for(const mark of finalHitMarks)mark.life-=dt;
            finalHitMarks=finalHitMarks.filter(mark=>mark.life>0);
            if(finalTimeLeft<=0)end('lose');
            else updateFinalHud();
        }
        if(rushEndPauseMs>0){
            // 終了宣告だけが動く専用の時計。ゲーム時計は停止し、
            // 物理・技タイマー・危険ライン・設置判定・粒子更新も一切しない。
            rushEndPauseMs=Math.max(0,rushEndPauseMs-dt);
            if(rushEndPauseMs===0){
                rushEndKind=null;
                hint('盤面をタップして落下／成立待ち玉は連打');
                updateHud();
            }
            return;
        }
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
                mode='playing';queueTouchingPairs();startRushEnd('strike');
            }
            if(mode==='throw'&&currentTime>=throwEnds)finishThrow();
            if(rushEndPauseMs>0)return;
            checkDanger();
        }
        particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=.07;p.life--});
        particles=particles.filter(p=>p.life>0);
        impacts.forEach(p=>p.life--);
        impacts=impacts.filter(p=>p.life>0);
        successMarks.forEach(mark=>mark.life-=dt);
        successMarks=successMarks.filter(mark=>mark.life>0);
        if(shake>0)shake*=.72;
    }
    function round(x,y,w,h,r) {ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
    // 描き直した和風背景（富士山・渓谷・滝・社・紅葉）を1枚絵として表示。
    // 前回の装飾の重ね描きは廃止。玉の視認性を確保する暗幕のみ残す。
    // 画像の読み込みに失敗した場合は単色の背景にフォールバックする。
    const scenery=new window.Image();
    scenery.decoding='async';
    scenery.src='./assets/wafuu-background.webp?v=20261024-fullscene1';
    function bg(){
        ctx.fillStyle='#433444';ctx.fillRect(0,0,W,H);
        if(scenery.complete&&scenery.naturalWidth>0){
            ctx.drawImage(scenery,0,0,W,H);
            ctx.fillStyle='rgba(12,10,18,.18)';ctx.fillRect(0,0,W,H);
        }
        if(!finalGameActive){
            ctx.fillStyle='#bb222d26';ctx.fillRect(0,0,W,DANGER);
            ctx.setLineDash([9,7]);ctx.lineWidth=2.3;ctx.strokeStyle='#ffccaa';
            ctx.beginPath();ctx.moveTo(0,DANGER);ctx.lineTo(W,DANGER);ctx.stroke();ctx.setLineDash([]);
            round(9,DANGER+7,79,21,4);ctx.fillStyle='#6b1b2ae8';ctx.fill();
            ctx.fillStyle='#fff1dd';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText('危険ライン',48,DANGER+22);
        }
        ctx.fillStyle='#2b2526b8';ctx.fillRect(0,FLOOR,W,H-FLOOR);
    }
    // 描き直した2D格闘ボール4種と、成立時の筆文字爆発演出3種を
    // 1枚の透過WebPへまとめた。読込失敗時は従来のCanvas描画を維持する。
    const combatArt=new window.Image();
    combatArt.decoding='async';
    combatArt.src='./assets/combat-art-atlas.png?v=20261025-finalart1';
    const BALL_ART={
        0:[5,5,80,80],1:[97,5,80,80],3:[189,5,80,80],5:[281,5,80,80]
    };
    const SUCCESS_ART={
        2:[5,94,107,81,125],4:[122,94,112,86,180],6:[244,94,116,87,252]
    };
    // 描画座標は元の404×185 atlas設計値。軽量化した320×148 PNGへ換算。
    const ART_SX=320/404,ART_SY=148/185;
    function hasCombatArt(){
        return combatArt.complete&&combatArt.naturalWidth===320&&combatArt.naturalHeight===148;
    }
    // 最新承認版の和風格闘ボールを透過WebPアトラスで一括管理。
    // 9段階の通常玉と最終戦の4段階（大道塾～ミニ道塾）で共通利用する。
    // 個々の切出領域は180×180px、192pxピッチで6pxの余白を付け、
    // 高速回転時の隣接アトラス色の滲みを回避する。
    const finalBallArt=new window.Image();
    finalBallArt.decoding='async';
    finalBallArt.src='./assets/final-ball-atlas.webp?v=20261025-approved2';
    const FINAL_BALL_ART={
        0:[6,6,180,180],        // 突：青系
        1:[198,6,180,180],      // 蹴：朱・橙
        2:[390,6,180,180],      // 効果：荒々しい筆文字
        3:[582,6,180,180],      // 投：緑
        4:[6,198,180,180],     // 技あり：紫
        5:[198,198,180,180],   // 極：関節技
        6:[390,198,180,180],   // 一本：赤・火炎
        7:[582,198,180,180],   // 空道：縦書き
        8:[6,390,180,180]      // 大道塾：背景「大」＋縦書き
    };
    const FINAL_FIGHT_ART=[
        [6,390,180,180],       // 大道塾
        [198,390,180,180],     // 中道塾
        [390,390,180,180],     // 小道塾
        [582,390,180,180]      // ミニ道塾：背景は横書き「ミニ」
    ];
    function hasFinalBallArt(){
        return finalBallArt.complete&&finalBallArt.naturalWidth===768&&
            finalBallArt.naturalHeight===576;
    }
    function drawFinalBallAsset(region,r){
        // 絵柄の黒い縁や白い輪が物理的な玉の外へはみ出さないよう
        // 明示的に中心揃え＋円形クリップする。アトラスの余白も吸収する。
        ctx.save();
        ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.clip();
        const drawRadius=r*.985;
        ctx.drawImage(finalBallArt,region[0],region[1],region[2],region[3],
            -drawRadius,-drawRadius,drawRadius*2,drawRadius*2);
        ctx.restore();
    }
    function ballDraw(lv,x,y,r,flash=0,opacity=1,hits=0,angle=0,black=false,pending=false,warningAlpha=0) {
        const d=TIERS[lv];ctx.save();ctx.globalAlpha=opacity;ctx.translate(x,y);ctx.rotate(angle);
        const approvedArt=FINAL_BALL_ART[lv];
        if(approvedArt&&!black&&hasFinalBallArt()){
            drawFinalBallAsset(approvedArt,r);
            // 連打待ちの9秒リングは従来どおり玉の上に表示する。
            if(flash>0){
                ctx.beginPath();ctx.arc(0,0,r-1,0,Math.PI*2);
                ctx.fillStyle='rgba(255,248,195,'+Math.min(.4,flash*.025)+')';ctx.fill();
            }
            if(warningAlpha>0){
                ctx.beginPath();ctx.arc(0,0,r-1,0,Math.PI*2);
                ctx.fillStyle='rgba(255,33,35,'+warningAlpha+')';ctx.fill();
                ctx.strokeStyle='rgba(255,135,105,.85)';ctx.lineWidth=3;ctx.stroke();
            }
            // 連打回数は絵柄を隠すので表示しない（成立判定には影響なし）。
            ctx.restore();return;
        }
        const art=BALL_ART[lv];
        if(art&&!black&&hasCombatArt()){
            ctx.shadowColor='#2b27233d';ctx.shadowBlur=7;ctx.shadowOffsetY=3;
            ctx.drawImage(combatArt,
                art[0]*ART_SX,art[1]*ART_SY,art[2]*ART_SX,art[3]*ART_SY,
                -r,-r,r*2,r*2);
            ctx.shadowBlur=0;ctx.shadowOffsetY=0;
            if(flash>0){
                ctx.beginPath();ctx.arc(0,0,r-1,0,Math.PI*2);
                ctx.fillStyle='rgba(255,248,195,'+(Math.min(.40,flash*.025))+')';ctx.fill();
            }
            ctx.restore();return;
        }
        ctx.shadowColor='#2b27233d';ctx.shadowBlur=7;ctx.shadowOffsetY=4;
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);
        const g=ctx.createRadialGradient(-r*.32,-r*.35,r*.1,0,0,r);
        g.addColorStop(0,black?(flash>0?'#9e4549':'#515158'):(flash>0?'#fff2b0':'#fff5ce'));
        g.addColorStop(.3,black?'#33343b':d.fill);g.addColorStop(1,black?'#16191e':d.edge);
        ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
        ctx.strokeStyle='#344755';ctx.lineWidth=r>35?3:2;ctx.stroke();
        ctx.beginPath();ctx.arc(-r*.2,-r*.26,r*.48,Math.PI*1.1,Math.PI*1.62);
        ctx.strokeStyle='#ffffff72';ctx.lineWidth=Math.max(2,r*.08);ctx.stroke();
        // 残り時間が少ない成立待ち玉だけ、本体全体を赤く明滅させる。
        // 漢字や残り打撃回数はこのあとに描き、常に読める状態を保つ。
        if(warningAlpha>0){
            ctx.beginPath();ctx.arc(0,0,r-1,0,Math.PI*2);
            ctx.fillStyle='rgba(255,33,35,'+warningAlpha+')';ctx.fill();
            ctx.lineWidth=3;
            ctx.strokeStyle='rgba(255,135,105,'+Math.min(.95,.28+warningAlpha)+')';
            ctx.stroke();
        }
        ctx.fillStyle=black?'#f4ebe1':'#1d2b35';
        // 大玉ほど筆文字がしっかり主張するように拡大。
        // 空道は2字、大道塾は3字なので、文字数に応じて高さを調整する。
        const nameSize=pending?(lv===6?Math.min(r*.74,58):Math.min(r*.7,32)):
            lv===3?Math.min(r*1.3,52):    // 投：従来40px→52px
            lv===5?Math.min(r*1.125,72): // 極：直径128pxの玉に合わせて72px
            lv===6?Math.min(r*.95,76):   // 一本：直径158pxの玉に釣り合う大きさへ
            lv===7?Math.min(r*.85,82):
            lv===8?Math.min(r*.60,72):Math.min(r*1.20,40);
        ctx.font=nameSize+'px "Yuji Boku","Yu Mincho",serif';
        const name=black?SPECIAL[lv].blackName:d.name;
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(name,0,pending?-r*.28:black?-r*.11:1,lv===6?r*1.9:r*1.75);
        ctx.restore();
    }
    // 成立した玉の「少し上」で短い筆文字が叩きつけられ、浮いて消える。
    // ゲーム座標を保存するので、玉が移動・合体しても演出位置はずれない。
    function drawSuccessMarks(){
        for(const mark of successMarks){
            const t=1-mark.life/mark.maxLife;
            const fade=t<.12?t/.12:t>.73?(1-t)/.27:1;
            const pop=t<.17?.55+.61*(t/.17):1.04-.04*Math.min((t-.17)/.25,1);
            // 文字数の多い「技あり」が「一本」と同格に見えないよう
            // 文字サイズと縁取り・光量を段階化する（一本の大きさは維持）。
            const asset=SUCCESS_ART[mark.level];
            const size=mark.level===6?73:mark.level===4?54:43;
            ctx.save();
            if(mark.black){
                // 黒玉化の「注意！／警告！／失格！」は玉の上へ筆文字で宣告。
                // 画面端では水平位置を補正し、持続時間の終わりで消える。
                const fontSize=mark.level===6?62:mark.level===4?53:44;
                ctx.font='900 '+fontSize+'px "Yuji Boku","Yu Mincho",serif';
                ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
                const textWidth=Math.min(W-24,ctx.measureText(mark.text).width);
                const x=clamp(mark.x,textWidth*.5+12,W-textWidth*.5-12);
                const y=clamp(mark.y-12*t,28,H-35);
                ctx.translate(x,y);ctx.scale(pop,pop);
                ctx.globalAlpha=clamp(fade,0,1);
                ctx.shadowColor='#f83a32';ctx.shadowBlur=12;
                ctx.strokeStyle='#1b080e';ctx.lineWidth=12;
                ctx.strokeText(mark.text,0,0,W-24);
                ctx.shadowBlur=0;ctx.strokeStyle='#a70e22';ctx.lineWidth=4;
                ctx.strokeText(mark.text,0,0,W-24);
                ctx.fillStyle='#ffe9bb';ctx.fillText(mark.text,0,0,W-24);
                ctx.restore();
                continue;
            }
            if(asset&&hasCombatArt()){
                const [sx,sy,sw,sh,width]=asset;
                const height=width*sh/sw;
                const x=clamp(mark.x,width*.47,W-width*.47);
                const y=clamp(mark.y-16*t,height*.36,H-height*.36);
                ctx.translate(x,y);ctx.scale(pop,pop);
                ctx.globalAlpha=clamp(fade,0,1);
                // 前の画像アトラス境界のにじみ防止：各辺を2px内側から採取。
                const trim=2;
                ctx.drawImage(combatArt,(sx+trim)*ART_SX,(sy+trim)*ART_SY,
                    (sw-trim*2)*ART_SX,(sh-trim*2)*ART_SY,
                    -width*.5,-height*.5,width,height);
            }else{
                // 画像が使えなくても「効果！／技あり！！／一本！！！」を
                // 従来どおり成立玉の上に表示し、ゲームを止めない。
                ctx.font='900 '+size+'px "Yuji Boku","Yu Mincho",serif';
                ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
                const width=Math.min(W-22,ctx.measureText(mark.text).width);
                const x=clamp(mark.x,width/2+11,W-width/2-11);
                const y=clamp(mark.y-16*t,38,H-45);
                ctx.translate(x,y);ctx.scale(pop,pop);
                ctx.globalAlpha=clamp(fade,0,1);
                ctx.shadowColor='#e65f2c';ctx.shadowBlur=mark.level===6?14:mark.level===4?10:6;
                ctx.strokeStyle='#2a0e16';ctx.lineWidth=mark.level===6?13:mark.level===4?10:8;
                ctx.strokeText(mark.text,0,0,W-24);
                ctx.shadowBlur=0;ctx.strokeStyle='#bf442e';
                ctx.lineWidth=mark.level===6?5:mark.level===4?4:3;
                ctx.strokeText(mark.text,0,0,W-24);
                ctx.fillStyle='#fff1b5';ctx.fillText(mark.text,0,0,W-24);
            }
            ctx.restore();
        }
    }
    // 「デュクシ！」に合わせた、短い白黄の8方向星型スパークと赤橙の衝撃線。
    // 全てCanvas描画なので追加の画像素材や通信は不要。
    // 90年代2D格闘の白い打撃スパーク。星形花火ではなく、白い芯と
    // 長さが不揃いの鋭い突起・淡い残像を瞬間的に表示する。
    function drawImpact(p) {
        const t=1-p.life/p.maxLife;
        const major=p.kind==='break'||p.level>=4;
        const size=(p.kind==='split'?(p.level>=5?78:65):
            p.kind==='hit'?22:major?40:30)*(.91+t*.31);
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
        if(p.kind==='split'){
            // 一瞬広がる衝撃波の輪。炎・煙ではなく純粋な打撃スパーク。
            ctx.globalAlpha=alpha*.84;
            ctx.lineWidth=7*(1-t)+1.5;
            ctx.strokeStyle='#fff0b5';
            ctx.beginPath();ctx.arc(0,0,size*(.3+.64*t),0,Math.PI*2);ctx.stroke();
        }
        ctx.globalCompositeOperation='source-over';
        ctx.restore();
    }
    // 残り時間リングが赤くなるのと同時（全9秒の残り35%）に本体も赤明滅。
    // 特殊玉が成立・時間切れになった時点で即終了。ラッシュ終了硬直中は
    // currentTime 自体が停止するため、他のタイマー同様に明滅も静止する。
    function specialWarningAlpha(b){
        const special=b.game.special;
        if(special?.state!=='pending')return 0;
        const remaining=special.expires-currentTime;
        const threshold=SPECIAL_TIME*.35;
        if(remaining<=0||remaining>=threshold)return 0;
        const urgency=clamp(1-remaining/threshold,0,1);
        const pulse=(1+Math.sin(currentTime*Math.PI*2/330))*.5;
        return (.12+.50*pulse)*(.82+.18*urgency);
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
            // 連打の残り回数は非表示。時間リングと残り秒数だけ維持。
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
            // 黒玉の解除回数も非表示。打撃ラッシュでの解除判定は継続。
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
    // 格闘ゲーム風のラッシュ終了宣告。盤面上に重ねるだけなので
    // ゲームを再開するまで玉もカウントダウンも完全に静止する。
    function drawRushEnd(){
        if(rushEndPauseMs<=0)return;
        const appearance=clamp((RUSH_END_PAUSE-rushEndPauseMs)/120,0,1);
        ctx.save();
        ctx.globalAlpha=appearance;
        ctx.fillStyle='rgba(8,7,13,.65)';
        ctx.fillRect(0,0,W,H);
        ctx.translate(W/2,H*.47);
        ctx.fillStyle='rgba(37,13,18,.94)';
        round(-W/2+13,-98,W-26,184,8);ctx.fill();
        ctx.lineWidth=4;ctx.strokeStyle='#f6c781';ctx.stroke();
        ctx.lineWidth=1;ctx.strokeStyle='#6c2a2c';
        ctx.strokeRect(-W/2+19,-92,W-38,172);
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=rushEndKind==='throw'?'#a9e3f6':'#ffe1aa';
        ctx.font='900 20px system-ui';
        ctx.fillText(rushEndKind==='throw'?'投げラッシュ':'打撃ラッシュ',0,-64);
        ctx.font='1000 93px "Yuji Boku","Yu Mincho",serif';
        ctx.lineJoin='round';ctx.lineWidth=9;
        ctx.strokeStyle='#5f171b';ctx.strokeText('終了！',0,11);
        ctx.lineWidth=3;ctx.strokeStyle='#fff0b5';
        ctx.strokeText('終了！',0,11);
        ctx.fillStyle='#f9bc63';ctx.fillText('終了！',0,11);
        ctx.fillStyle='#f7e0bc';ctx.font='bold 14px system-ui';
        ctx.fillText('構え直し！',0,68);
        ctx.restore();
    }
    function render() {
        ctx.save();if(rushEndPauseMs===0&&shake>.25)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
        bg();
        balls.forEach(b=>{
            if(b.game.finalStage!==undefined){drawFinalBall(b);return}
            const black=b.game.special?.state==='black';
            ballDraw(b.game.level,b.position.x,b.position.y,b.circleRadius,b.game.flash,1,Math.ceil(b.game.hits),b.angle,black,b.game.special?.state==='pending',specialWarningAlpha(b));
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
        drawSuccessMarks();
        ctx.restore();
        if(finalGameActive)drawFinalOverlay();
        drawRushEnd();
    }
    function resize() {
        const d=Math.min(window.devicePixelRatio||1,2.5);
        canvas.width=Math.round(W*d);canvas.height=Math.round(H*d);
        ctx.setTransform(d,0,0,d,0,0);
        // 画面回転やウィンドウサイズ変更時もラッシュOKの幅を再計算。
        if(ui.alert.classList.contains('end-call'))fitEndCallNotice();
        else if(/^(打撃|投げ)ラッシュOK！$/.test(ui.alert.textContent))
            fitRushReadyNotice();
    }
    function coord(e){
        const r=canvas.getBoundingClientRect();
        return {x:clamp((e.clientX-r.left)*W/r.width,0,W),y:clamp((e.clientY-r.top)*H/r.height,0,H)};
    }
    // 盤面全体が落下エリア。ただし成立待ちの玉は、判定を12px広げて打撃を優先する。
    // pointerdownで打撃／落下を確定し、落下だけpointerupで発動する。
    // これにより素早い連打でも技へのタップが誤投下にならない。
    canvas.addEventListener('pointerdown',e=>{
        if(!['playing','strike','throw','final'].includes(mode))return;
        e.preventDefault();
        if(rushEndPauseMs>0)return;
        audio.start();
        const {x,y}=coord(e);
        if(mode==='final'){hitFinal(x,y);return}
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
        if(rushEndPauseMs>0||pointer===null||e.pointerId!==pointer)return;
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
        if(rushEndPauseMs>0)return;
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
        if(mode==='final'){
            if(e.key==='Enter'||e.key===' '){
                e.preventDefault();hitFinal(W/2,H/2);
            }
            return;
        }
        if(mode!=='playing'||rushEndPauseMs>0)return;
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
    // タッチのpointerdownはiOSでメディア再生許可と見なされない場合がある。
    // 指を離すtouchendとボタンのclickで再試行（Androidの操作・音は変更しない）。
    if(IOS_AUDIO){
        window.addEventListener('touchend',()=>audio.unlockIOS(),{capture:true,passive:true});
        window.addEventListener('click',()=>audio.unlockIOS(),true);
    }
    document.addEventListener('visibilitychange',()=>{
        lastFrame=performance.now();accumulator=0;
        if(!document.hidden&&audio.ctx&&!muted)audio.start();
    });
    window.addEventListener('pageshow',()=>{
        if(audio.ctx&&!muted)audio.start();
    });
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
