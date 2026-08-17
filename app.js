/* ============================================================
   我的工作台 · 核心逻辑
   - RSS 抓取（含 CORS 代理兜底链）
   - 每日按日期推荐 TED 与英语练习（确定性，每天不同）
   - localStorage 缓存降级
   ============================================================ */

// ---------- 配置：RSS 源 ----------
const SOURCES = {
  property: [
    {
      name:'CommercialCafe · 商业地产',
      url:'https://www.commercialcafe.com/blog/feed/',
      type:'wp',
      lang:'en',
      desc:true
    },
    {
      name:'RealEstateAgentMagazine',
      url:'https://www.realestateagentmagazine.com/feed/',
      type:'wp',
      lang:'en',
      desc:true
    },
    {
      name:'ScienceDaily · 商业研究',
      url:'https://www.sciencedaily.com/rss/business_industry.xml',
      type:'rss',
      lang:'en',
      desc:true
    }
  ],
  green: [
    {
      name:'ScienceDaily · 地球与气候',
      url:'https://www.sciencedaily.com/rss/earth_climate.xml',
      type:'rss',
      lang:'en',
      desc:true
    },
    {
      name:'TriplePundit · 可持续商业',
      url:'https://www.triplepundit.com/feed/',
      type:'wp',
      lang:'en',
      desc:false
    },
    {
      name:'ScienceDaily · 能源与材料',
      url:'https://www.sciencedaily.com/rss/matter_energy.xml',
      type:'rss',
      lang:'en',
      desc:true
    }
  ],
  news: [
    {
      name:'ABC News · 头条',
      url:'https://abcnews.go.com/abcnews/topstories',
      type:'rss',
      lang:'en',
      desc:true
    },
    {
      name:'ABC News · 国际',
      url:'https://abcnews.go.com/abcnews/internationalheadlines',
      type:'rss',
      lang:'en',
      desc:true
    },
    {
      name:'ABC News · 娱乐',
      url:'https://abcnews.go.com/abcnews/entertainmentheadlines',
      type:'rss',
      lang:'en',
      desc:true
    },
    {
      name:'NPR · 世界',
      url:'https://feeds.npr.org/1004/rss.xml',
      type:'rss',
      lang:'en',
      desc:true
    },
    {
      name:'NPR · 文艺',
      url:'https://feeds.npr.org/1048/rss.xml',
      type:'rss',
      lang:'en',
      desc:true
    }
  ]
};

// ---------- CORS 代理兜底链（按序尝试） ----------
// 公共代理可能不稳定/有 rate-limit，所以做链式兜底；第一个成功即停。
// 部署到生产时建议换成你自己的后端代理路径（如 /proxy?url=...）。
const PROXIES = [
  // 优先：本地自带的代理（部署时把它换成你自己的后端）
  u => `./proxy?url=${encodeURIComponent(u)}`,
  // 兜底：公共代理
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  u => u  // 最后直连（同源时）
];

// ---------- 工具：日期 ----------
function todayKey(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtCNDate(){
  const d=new Date();
  const wk=['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 · 周${wk}`;
}
// 以日期为种子的伪随机（同一天结果稳定，每天不同）
function seededRand(seedStr){
  let h=2166136261;
  for(let i=0;i<seedStr.length;i++){h^=seedStr.charCodeAt(i);h=Math.imul(h,16777619)}
  return ()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}
}

// ---------- 工具：HTML 转义 ----------
function esc(s){
  if(!s) return '';
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function stripTags(html){
  if(!html) return '';
  const d=document.createElement('div');
  d.innerHTML=html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1');
  return (d.textContent||d.innerText||'').trim();
}

// ---------- 发音功能（Web Speech API） ----------
// 浏览器原生，免费、离线、无需任何服务
let __voices=[];
let __rate=0.9;  // 默认稍慢，方便跟读
let __voicesReady=false;
function loadVoices(){
  if(!('speechSynthesis' in window)) return;
  __voices=speechSynthesis.getVoices().filter(v=>/en[-_]/i.test(v.lang)||/en/i.test(v.lang));
  __voicesReady=__voices.length>0;
}
if('speechSynthesis' in window){
  loadVoices();
  speechSynthesis.onvoiceschanged=loadVoices;
  // 某些浏览器需要主动触发一次
  setTimeout(loadVoices, 300);
  setTimeout(loadVoices, 1000);
}
function pickVoice(){
  return __voices.find(v=>/en[-_]US/i.test(v.lang))
      || __voices.find(v=>/en/i.test(v.lang))
      || null;
}
// 预热：iOS Safari 需要首次用户交互后才能发音，第一次点会激活
let __warmed=false;
function warmupSpeech(){
  if(__warmed || !('speechSynthesis' in window)) return;
  __warmed=true;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance('');
  u.volume=0;
  speechSynthesis.speak(u);
}
function speak(text, opts){
  if(!('speechSynthesis' in window)){
    alert('当前浏览器不支持语音合成，请用 Safari 或 Chrome 试试');
    return;
  }
  warmupSpeech();
  opts=opts||{};
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang='en-US';
  u.rate=opts.rate||__rate;
  u.pitch=1;
  u.volume=1;
  const v=pickVoice();
  if(v) u.voice=v;
  const btn=opts.btn;
  if(btn){
    btn.classList.add('playing');
    u.onend=()=>btn.classList.remove('playing');
    u.onerror=()=>btn.classList.remove('playing');
  }
  speechSynthesis.speak(u);
}
function speakWord(word, btn){
  // 词汇发音：只读英文部分（去掉中文释义）
  const en=word.replace(/[\u4e00-\u9fa5].*$/,'').trim();
  speak(en,{btn:btn,rate:0.8});
}
function setRate(r){
  __rate=r;
  document.querySelectorAll('.speak-ctrl .spd button').forEach(b=>{
    b.classList.toggle('active', parseFloat(b.dataset.rate)===r);
  });
}

// 事件委托：处理带 data-speak 的元素点击发音
document.addEventListener('click', e=>{
  const el=e.target.closest('[data-speak]');
  if(!el) return;
  e.preventDefault();
  const text=el.getAttribute('data-speak');
  const isWord=el.classList.contains('chip');
  if(isWord){
    speakWord(text, el);
  } else {
    speak(text, {btn:el});
  }
});

// ---------- 核心：抓取 RSS（带兜底 + 缓存） ----------
async function fetchRSS(source){
  const cacheKey='rss_'+source.name+'_'+todayKey();
  // 1. 今日缓存命中则直接返回
  try{
    const cached=localStorage.getItem(cacheKey);
    if(cached){
      const obj=JSON.parse(cached);
      if(obj && obj.items && obj.items.length) return obj.items;
    }
  }catch(e){}

  // 2. 走代理链
  let lastErr=null;
  for(const make of PROXIES){
    const url=make(source.url);
    try{
      const ctrl=new AbortController();
      const to=setTimeout(()=>ctrl.abort(),15000);
      const res=await fetch(url,{signal:ctrl.signal,redirect:'follow'});
      clearTimeout(to);
      if(!res.ok) { lastErr=new Error('HTTP '+res.status); continue; }
      const text=await res.text();
      if(!text || text.length<200){ lastErr=new Error('内容过短'); continue; }
      const items=parseFeed(text,source);
      if(items && items.length){
        try{ localStorage.setItem(cacheKey, JSON.stringify({ts:Date.now(),items:items.slice(0,30)})); }catch(e){}
        return items;
      }
      lastErr=new Error('解析为空');
    }catch(e){ lastErr=e; }
  }
  // 3. 兜底：取旧的缓存（哪怕是昨天的）
  try{
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k && k.startsWith('rss_'+source.name+'_')){
        const obj=JSON.parse(localStorage.getItem(k));
        if(obj && obj.items && obj.items.length) return obj.items;
      }
    }
  }catch(e){}
  return [];
}

// ---------- 解析 RSS / Atom / WP Feed ----------
function parseFeed(text, source){
  const items=[];
  try{
    const dom=new DOMParser().parseFromString(text,'text/xml');
    // RSS 2.0
    let nodes=[...dom.querySelectorAll('item')];
    if(nodes.length){
      for(const it of nodes){
        const title=stripTags(it.querySelector('title')?.textContent||'');
        const link=it.querySelector('link')?.textContent?.trim() || it.querySelector('guid')?.textContent?.trim() || '';
        const descRaw=it.querySelector('description')?.textContent||'';
        const desc=source.desc? stripTags(descRaw):'';
        const pub=it.querySelector('pubDate')?.textContent||it.querySelector('published')?.textContent||'';
        items.push({title,link,desc,pub,source:source.name});
      }
      return items;
    }
    // Atom
    nodes=[...dom.querySelectorAll('entry')];
    for(const e of nodes){
      const title=stripTags(e.querySelector('title')?.textContent||'');
      const link=e.querySelector('link')?.getAttribute('href')||e.querySelector('id')?.textContent||'';
      const desc=source.desc? stripTags(e.querySelector('summary')?.textContent||e.querySelector('content')?.textContent||''):'';
      const pub=e.querySelector('updated')?.textContent||e.querySelector('published')?.textContent||'';
      items.push({title,link,desc,pub,source:source.name});
    }
  }catch(e){ console.warn('parse error',e); }
  return items;
}

// ---------- 工具：相对时间 ----------
function relTime(pubStr){
  if(!pubStr) return '';
  const t=new Date(pubStr);
  if(isNaN(t)) return '';
  const diff=Date.now()-t.getTime();
  const d=Math.floor(diff/86400000);
  if(d<=0){
    const h=Math.floor(diff/3600000);
    if(h<=0){const m=Math.floor(diff/60000);return m<=1?'刚刚':m+' 分钟前'}
    return h+' 小时前';
  }
  if(d===1) return '昨天';
  if(d<7) return d+' 天前';
  return (t.getMonth()+1)+'月'+t.getDate()+'日';
}

// ---------- 渲染：资讯条目 ----------
function renderItemHTML(it){
  const r=relTime(it.pub);
  const isNew = r && (r==='刚刚' || /小时前/.test(r));
  return `<a class="item" href="${esc(it.link)}" target="_blank" rel="noopener">
    <div class="it-title">${esc(it.title)}</div>
    ${it.desc?`<div class="it-desc">${esc(it.desc.slice(0,160))}</div>`:''}
    <div class="it-meta">
      <span class="src">${esc(it.source)}</span>
      ${r?`<span class="${isNew?'new':''}">${isNew?'● ':''}${r}</span>`:''}
    </div>
  </a>`;
}
function renderItemsList(items, limit){
  if(!items || !items.length){
    return `<div class="empty">暂未取到内容<button class="retry-btn" onclick="loadAll()">重试</button></div>`;
  }
  return items.slice(0,limit||8).map(renderItemHTML).join('');
}

// ---------- 渲染：商务英语（每日一练，确定性） ----------
const ENG_LESSONS = [
  {
    scene:'开场破冰 · 接待访客',
    q:'How would you like your coffee? We have a meeting room booked for 10.',
    a:"Black is fine, thank you. And yes, the 10 o'clock slot works perfectly — I appreciate the arrangement.",
    tip:'<b>句型</b>：How would you like...? / works perfectly / appreciate the arrangement。商务接待中用 appreciate 比 thanks 更显专业。',
    vocab:['slot 时段','arrangement 安排','appreciate 感谢']
  },
  {
    scene:'介绍公司业务 · 物业资产',
    q:'Our portfolio covers grade-A offices and mixed-use complexes across first-tier cities.',
    a:'That sounds impressive. Could you walk me through the occupancy rate and major tenants?',
    tip:'<b>grade-A offices 甲级写字楼</b>、<b>mixed-use 综合体</b>、<b>occupancy rate 出租率</b>、<b>major tenants 主力租户</b>——这是楼宇交易谈判高频词。',
    vocab:['portfolio 资产组合','occupancy 出租率','tenant 租户','grade-A 甲级']
  },
  {
    scene:'谈绿色金融 · ESG',
    q:'We\'re exploring green bonds to finance our building retrofitting projects.',
    a:'That aligns well with the dual-carbon goals. Have you looked into the tax incentives for certified green buildings?',
    tip:'<b>green bonds 绿色债券</b>、<b>retrofitting 改造</b>、<b>dual-carbon goals 双碳目标</b>、<b>tax incentives 税收优惠</b>——绿色金融谈判核心词。',
    vocab:['green bonds 绿色债券','retrofit 改造','dual-carbon 双碳','incentive 激励']
  },
  {
    scene:'报价与谈判',
    q:'Given the current market, we\'re looking at a price in the range of 320 million RMB.',
    a:'I see. Before we discuss numbers, could you share the rationale behind that valuation?',
    tip:'<b>in the range of 在���区间</b>、<b>rationale 依据/逻辑</b>、<b>valuation 估值</b>。谈判中先问 rationale 而不是直接还价，更显专业与冷静。',
    vocab:['valuation 估值','rationale 依据','in the range of 在…区间','market 市况']
  },
  {
    scene:'会议收尾 · 明确下一步',
    q:'Let\'s circle back next week once we\'ve reviewed the due diligence materials.',
    a:'Sounds good. I\'ll send over the data room access by Friday so your team can start the review.',
    tip:'<b>circle back 稍后再议</b>、<b>due diligence 尽职调查</b>、<b>data room 数据室</b>。楼宇交易 DD 阶段必备表达。',
    vocab:['circle back 再议','due diligence 尽调','data room 数据室','review 审查']
  },
  {
    scene:'邮件开场 · 跟进',
    q:'Following up on our call last Thursday — I\'ve attached the revised term sheet for your review.',
    a:'Thanks for the prompt follow-up. I\'ll get back to you with comments by Wednesday EOD.',
    tip:'<b>Following up on... 跟进…</b>、<b>term sheet 条款清单</b>、<b>EOD = end of day 当天下班前</b>。外企邮件高频缩写要熟。',
    vocab:['term sheet 条款清单','prompt 及时的','EOD 当日截止','comments 意见']
  },
  {
    scene:'讨论可持续认证',
    q:'The building is targeting LEED Platinum certification as part of our ESG strategy.',
    a:'That\'s a strong differentiator. How does the payback period look for the additional capex?',
    tip:'<b>LEED Platinum 铂金级认证</b>、<b>ESG strategy</b>、<b>payback period 回收期</b>、<b>capex 资本支出</b>。绿色楼宇估值谈判核心。',
    vocab:['LEED 认证','differentiator 差异点','payback 回收期','capex 资本支出']
  },
  {
    scene:'跨部门沟通 · 协调',
    q:'Could you loop in the technical team? We need their input on the HVAC upgrade scope.',
    a:'Will do. I\'ll set up a 30-minute sync tomorrow afternoon to align on the scope.',
    tip:'<b>loop in 把…拉进来</b>、<b>sync 同步会</b>、<b>align on 对齐</b>。外企日常协作高频动词短语。',
    vocab:['loop in 拉入','sync 同步会','align 对齐','HVAC 暖通空调']
  }
];
function engBlockHTML(L){
  // 用 data-speak 属性传文本，避免引号冲突
  const qAttr=esc(L.q).replace(/"/g,'&quot;');
  const aAttr=esc(L.a).replace(/"/g,'&quot;');
  return `
    <div class="eng-scene">
      <div class="scene-lbl">📅 场景 · ${L.scene}</div>
      <div class="scene-row scene-q">
        <div class="text">🗣️ ${esc(L.q)}</div>
        <button class="speak-btn" data-speak="${qAttr}" title="朗读">🔊</button>
      </div>
      <div class="scene-row scene-a">
        <div class="text">💬 ${esc(L.a)}</div>
        <button class="speak-btn" data-speak="${aAttr}" title="朗读">🔊</button>
      </div>
    </div>
    <div class="eng-tip">${L.tip}</div>
    <div class="ted-vocab">${L.vocab.map(v=>{
      const vAttr=esc(v).replace(/"/g,'&quot;');
      return `<span class="chip" data-speak="${vAttr}" title="点击发音">${esc(v)}</span>`;
    }).join('')}</div>
    <div class="speak-ctrl">
      <span class="lbl">语速</span>
      <div class="spd">
        <button data-rate="0.7" onclick="setRate(0.7)">慢</button>
        <button data-rate="0.9" class="active" onclick="setRate(0.9)">正常</button>
        <button data-rate="1.1" onclick="setRate(1.1)">快</button>
      </div>
      <span style="color:#94a3b8">💡 点🔊朗读，点词汇听发音</span>
    </div>
    <div class="eng-tip" style="margin-top:8px;color:#94a3b8">💡 建议：先听一遍，再跟读三遍，最后用自己的话复述应答。</div>
  `;
}

function renderEnglish(){
  const seed=seededRand('eng_'+todayKey());
  const idx=Math.floor(seed()*ENG_LESSONS.length);
  const L=ENG_LESSONS[idx];
  document.getElementById('ld-english').innerHTML=engBlockHTML(L);
  window.__engAll = ENG_LESSONS;
}

// ---------- 渲染：TED 演讲 ----------
// 精选短时长（≤8min）TED 演讲库，每日轮播
const TED_PICKS = [
  { id:'3gIa2gT4RJ4', title:'How to speak so that people want to listen', speaker:'Julian Treasure', len:'7:50', lang:'en',
    points:['开场用"power"声位——压低、放慢、带气声，立刻显得权威','四种该避免的坏习惯：流言、评判、消极、抱怨','用音量、音调、节奏、停顿改变演讲质感——这是"声音的工具箱"','建议每天做"声带热身"：嘴唇颤音、绕舌、夸张发音'],
    vocab:['power 威严','pitch 音调','pace 节奏','resonance 共鸣','articulate 清晰'] },
  { id:'H14bBuluwB8', title:'How great leaders inspire action', speaker:'Simon Sinek', len:'17:58', lang:'en',
    points:['"Why → How → What" 黄金圈：先讲为什么，再讲怎么做、做什么','人们不买你"做什么"，买你"为什么做"','用"内向清晰"的使命句吸引认同者','演讲结构：观点先行 + 故事支撑 + 重复金句'],
    vocab:['inspire 激发','golden circle 黄金圈','belief 信念','adopt 采纳','mantra 信条'] },
  { id:'arj7oStGLkU', title:'The power of vulnerability', speaker:'Brené Brown', len:'20:19', lang:'en',
    points:['脆弱不是软弱，而是勇气的衡量标尺','讲个人故事时，先讲"感受"再讲"事件"——共情由此产生','让听众感到"被看见"，比说服他们更重要','口才的本质：让人愿意听你，而不是佩服你'],
    vocab:['vulnerability 脆弱','courage 勇气','empathy 共情','shame 羞耻','worthiness 价值感'] },
  { id:'Zip9gOZ0rJo', title:'The danger of a single story', speaker:'Chimamanda Ngozi Adichie', len:'19:16', lang:'en',
    points:['单一叙事会制造刻板印象——商务沟通同理，避免以偏概全','用"反差"开场：先讲一个被误解的故事，再揭示全貌','节奏控制：在关键转折前留 2 秒停顿','个人经历是最有说服力的论据'],
    vocab:['single story 单一叙事','stereotype 刻板','impression 印象','nuance 细微差别','disclose 揭示'] },
  { id:'Ks-_Mh1QhMc', title:'Your body language shapes who you are', speaker:'Amy Cuddy', len:'21:02', lang:'en',
    points:['"高能量姿势"2 分钟即可改变激素水平——睾酮升、皮质醇降','演讲前做"权力姿势"能显著降低紧张感','肢体语言决定别人对你的第一印象，也反向塑造你自己','Fake it till you become it——装下去，直到你成为它'],
    vocab:['posture 姿势','testosterone 睾酮','cortisol 皮质醇','confidence 自信','presence 气场'] },
  { id:'5MgBikgcWnY', title:'How to make stress your friend', speaker:'Kelly McGonigal', len:'14:28', lang:'en',
    points:['把紧张重新定义为"兴奋"——生理反应相似，认知评价决定感受','演讲时心跳加速是身体在为你供能，不是在崩溃','用"提问"代替"陈述"，把压力转化为与听众的连接','结尾呼吁行动：让听众带走一个可执行的改变'],
    vocab:['stress 压力','resilience 韧性','arousal 唤起','reframe 重新定义','vessel 容器'] },
  { id:'MihXD8vZi7c', title:'The puzzles of perspective', speaker:'Beau Lotto', len:'16:26', lang:'en',
    points:['大脑不是被动接收信息，而是主动"猜测"——所以讲故事能引导认知','用视觉错觉开场，立刻打破听众的确定性','让听众"发现"答案，而不是告诉他们答案','商务提案也可以制造"认知惊喜"'],
    vocab:['perception 感知','illusion 错觉','assumption 假设','context 语境','insight 顿悟'] },
  { id:'8jPQjjsBbIc', title:'The skill of self-confidence', speaker:'Ivan Joseph', len:'13:20', lang:'en',
    points:['自信是可训练的技能，不是天赋——靠"自我对话的重复"建立','用"正向自我赞许"替代"自我苛责"，每天重复','演讲前在脑中预演成功画面，而非失败场景','坚持一份"夸自己的清单"，临场紧张时翻看'],
    vocab:['self-confidence 自信','affirmation 肯定','repetition 重复','self-talk 自我对话','grit 毅力'] }
];

function tedBlockHTML(p){
  const titleAttr=esc(p.title+'. By '+p.speaker).replace(/"/g,'&quot;');
  return `
    <div class="ted-block">
      <div class="ted-title">${esc(p.title)}</div>
      <div class="ted-speaker">🎤 ${esc(p.speaker)} · ⏱️ ${p.len} · ${p.lang==='en'?'英文原声':''}
        <button class="speak-btn sm" data-speak="${titleAttr}" title="朗读标题" style="vertical-align:-3px;margin-left:6px">🔊</button>
      </div>
      <div class="ted-video-wrap">
        <iframe src="https://www.youtube-nocookie.com/embed/${p.id}" title="${esc(p.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>
        <div class="ted-fallback">▶ 在浏览器内可能无法播放<br>点击下方按钮跳转到 TED.com 观看<br><a href="https://www.ted.com/search?q=${encodeURIComponent(p.title)}" target="_blank" rel="noopener">在 TED.com 打开 →</a></div>
      </div>
      <div class="ted-points">
        <div class="lbl">📚 学习要点 · 演讲技巧拆解</div>
        <ul>${p.points.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="ted-vocab">${p.vocab.map(v=>{
        const vAttr=esc(v).replace(/"/g,'&quot;');
        return `<span class="chip" data-speak="${vAttr}" title="点击发音">${esc(v)}</span>`;
      }).join('')}</div>
      <div style="margin-top:10px;font-size:12px"><a href="https://www.ted.com/search?q=${encodeURIComponent(p.title)}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600">📺 在 TED.com 打开演讲 →</a></div>
    </div>
  `;
}

function renderTED(){
  const seed=seededRand('ted_'+todayKey());
  const pick=TED_PICKS[Math.floor(seed()*TED_PICKS.length)];
  document.getElementById('ld-ted').innerHTML=tedBlockHTML(pick);
  window.__tedAll = TED_PICKS;
}

// ---------- 渲染：资讯模块 ----------
// 策略：先读本地 feed.json 立即显示（保证手机一定能看到内容），
//       再异步尝试通过代理拉最新 RSS 覆盖（如果网络允许）。
async function loadBundledData(){
  try{
    const res=await fetch('./data/feed.json',{cache:'no-store'});
    if(!res.ok) return null;
    const j=await res.json();
    return j;
  }catch(e){ return null; }
}

function applyItems(cat, items, limit){
  const idMap={property:'ld-property', green:'ld-green', news:'ld-news'};
  const varMap={property:'__propertyAll', green:'__greenAll', news:'__newsAll'};
  const el=document.getElementById(idMap[cat]);
  if(el) el.outerHTML=`<div>${renderItemsList(items, limit||5)}</div>`;
  window[varMap[cat]]=items;
}

async function loadCategory(cat, limit){
  const idMap={property:'ld-property', green:'ld-green', news:'ld-news'};
  // 1. 先用本地打包数据立即渲染
  const bundled=await loadBundledData();
  if(bundled && bundled.data && bundled.data[cat]){
    applyItems(cat, bundled.data[cat], limit);
  }
  // 2. 异步尝试拉最新（成功则覆盖）
  const all=[];
  for(const s of (SOURCES[cat]||[])){
    const items=await fetchRSS(s);
    all.push(...items);
  }
  if(all.length){
    all.sort((a,b)=> {
      const ta=new Date(a.pub).getTime()||0;
      const tb=new Date(b.pub).getTime()||0;
      return tb-ta;
    });
    applyItems(cat, all, limit);
  } else if(!bundled || !bundled.data[cat]){
    const el=document.getElementById(idMap[cat]);
    if(el) el.outerHTML=`<div class="empty">暂未取到内容<button class="retry-btn" onclick="loadAll()">重试</button></div>`;
  }
}
async function loadProperty(limit){ return loadCategory('property', limit); }
async function loadGreen(limit){ return loadCategory('green', limit); }
async function loadNews(limit){ return loadCategory('news', limit); }

// ---------- 总加载 ----------
async function loadAll(){
  document.getElementById('todayDate').textContent=fmtCNDate();
  renderEnglish();
  renderTED();
  // 并行加载资讯模块
  loadProperty();
  loadGreen();
  loadNews();
}

// ---------- 视图切换 ----------
const TAB_META={
  today:{title:'今日工作台', ic:'🏠', tag:'每日精选', view:'today'},
  property:{title:'物业资产 · 楼宇交易', ic:'🏢', tag:'商业地产资讯完整列表', view:'list', key:'propertyAll'},
  green:{title:'绿色金融 · 双碳动态', ic:'🌱', tag:'双碳与可持续资讯完整列表', view:'list', key:'greenAll'},
  news:{title:'每日热点新闻', ic:'📰', tag:'国际 · 娱乐 · 社会热点', view:'list', key:'newsAll'},
  english:{title:'商务英语 · 每日一练', ic:'💬', tag:'全部练习场景', view:'list', key:'engAll'},
  ted:{title:'TED 演讲 · 演讲口才', ic:'🎤', tag:'精选短演讲合集', view:'list', key:'tedAll'}
};

function switchTab(tab){
  document.querySelectorAll('.tabbar a').forEach(a=>a.classList.toggle('active', a.dataset.tab===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));

  const meta=TAB_META[tab];
  if(tab==='today'){
    document.getElementById('view-today').classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});
    return;
  }
  // 列表视图
  document.getElementById('view-list').classList.add('active');
  document.getElementById('list-ic').textContent=meta.ic;
  document.getElementById('list-title').textContent=meta.title;
  document.getElementById('list-tag').textContent=meta.tag;
  const body=document.getElementById('list-body');

  if(tab==='property'||tab==='green'||tab==='news'){
    const items=window['__'+meta.key]||[];
    body.innerHTML = items.length? renderItemsList(items, 40) : `<div class="empty">数据加载中，请稍候或返回今日页刷新<button class="retry-btn" onclick="switchTab('today')">返回今日</button></div>`;
  } else if(tab==='english'){
    const all=window.__engAll||[];
    body.innerHTML = all.map((L,i)=>`
      <div class="ted-block">
        <div class="ted-title">第 ${i+1} 课 · ${esc(L.scene)}</div>
        ${engBlockHTML(L)}
      </div>
    `).join('');
  } else if(tab==='ted'){
    const all=window.__tedAll||[];
    body.innerHTML = all.map(p=>tedBlockHTML(p)).join('');
  }
  window.scrollTo({top:0,behavior:'smooth'});
}

// ---------- 事件绑定 ----------
document.addEventListener('click', e=>{
  const t=e.target.closest('[data-tab]');
  if(t){ e.preventDefault(); switchTab(t.dataset.tab); }
});
document.getElementById('refreshBtn').addEventListener('click', ()=>{
  // 清今日缓存重拉
  const keys=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k && k.endsWith(todayKey())) keys.push(k);
  }
  keys.forEach(k=>localStorage.removeItem(k));
  location.reload();
});

// ---------- 启动 ----------
loadAll();

// ---------- PWA 注册 ----------
if('serviceWorker' in navigator){
  // 简单注册（manifest 已支持添加到主屏幕）
  // Service Worker 可选，这里不强制注册以避免离线缓存导致内容不更新
}
