#!/usr/bin/env python3
"""抓取最新 RSS 数据，更新 feed.json"""
import urllib.request, json, xml.etree.ElementTree as ET, html, re, gzip
from datetime import datetime

UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
def fetch(url, retries=3):
    import time
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding':'gzip'})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read()
                enc = r.headers.get('Content-Encoding','')
                if 'gzip' in enc or data[:2] == b'\x1f\x8b':
                    data = gzip.decompress(data)
                return data.decode('utf-8', errors='replace')
        except Exception as e:
            last = e
            time.sleep(2)  # 稍等重试，绕过临时限流
    raise last
def strip(h):
    if not h: return ''
    h = re.sub(r'<!\[CDATA\[([\s\S]*?)\]\]>', r'\1', h)
    h = re.sub(r'<[^>]+>', '', h)
    return html.unescape(h).strip()
def parse(text):
    items = []
    try:
        dom = ET.fromstring(text)
        for it in dom.findall('.//item'):
            t=it.find('title'); l=it.find('link'); d=it.find('description'); p=it.find('pubDate')
            items.append({'title':strip(t.text if t is not None else ''),'link':(l.text.strip() if l is not None and l.text else ''),'desc':strip(d.text if d is not None else '')[:300],'pub':(p.text.strip() if p is not None and p.text else '')})
        for e in dom.findall('.//entry'):
            t=e.find('title'); l=e.find('link'); d=e.find('summary')
            if d is None: d=e.find('content')
            p=e.find('updated')
            if p is None: p=e.find('published')
            href=l.get('href') if l is not None else ''
            items.append({'title':strip(t.text if t is not None else ''),'link':href or '','desc':strip(d.text if d is not None else '')[:300],'pub':(p.text.strip() if p is not None and p.text else '')})
    except Exception as e: print('parse err:',e)
    return items

sources = {
    'property': [('CommercialCafe · 商业地产','https://www.commercialcafe.com/blog/feed/'),('RealEstateAgentMagazine','https://www.realestateagentmagazine.com/feed/'),('ScienceDaily · 商业研究','https://www.sciencedaily.com/rss/business_industry.xml')],
    'green': [('ScienceDaily · 地球与气候','https://www.sciencedaily.com/rss/earth_climate.xml'),('TriplePundit · 可持续商业','https://www.triplepundit.com/feed/'),('ScienceDaily · 能源与材料','https://www.sciencedaily.com/rss/matter_energy.xml')],
    'news': [('ABC News · 头条','https://abcnews.go.com/abcnews/topstories'),('ABC News · 国际','https://abcnews.go.com/abcnews/internationalheadlines'),('ABC News · 娱乐','https://abcnews.go.com/abcnews/entertainmentheadlines'),('NPR · 世界','https://feeds.npr.org/1004/rss.xml'),('NPR · 文艺','https://feeds.npr.org/1048/rss.xml')]
}
result = {}
for cat, feeds in sources.items():
    all_items = []
    for name, url in feeds:
        try:
            items = parse(fetch(url))
            for it in items: it['source']=name
            all_items.extend(items)
            print(f'{cat}/{name}: {len(items)}')
        except Exception as e: print(f'{cat}/{name}: ERR {e}')
    def keyf(it):
        try: return datetime.strptime(it['pub'], '%a, %d %b %Y %H:%M:%S %z').timestamp()
        except:
            try: return datetime.strptime(it['pub'], '%Y-%m-%dT%H:%M:%S%z').timestamp()
            except: return 0
    all_items.sort(key=keyf, reverse=True)
    result[cat] = all_items[:50]
with open('/workspace/workbench-app/data/feed.json','w',encoding='utf-8') as f:
    json.dump({'fetched_at':datetime.now().strftime('%Y-%m-%d %H:%M:%S'),'data':result}, f, ensure_ascii=False, indent=2)
print('property:',len(result.get('property',[])),'green:',len(result.get('green',[])),'news:',len(result.get('news',[])))
print('feed.json updated')
