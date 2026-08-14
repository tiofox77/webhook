import re
with open('analysis-today.js','rb') as f:
    raw = f.read()
text = raw.decode('utf-8')
# Replace literal "3****00" with actual number
text = text.replace('3****00','3600000')
# Dedupe isoDateWAT function
text = re.sub(r'(function isoDateWAT\(d\) \{ const w=new Date\(d\.getTime\(\)\+3600000\); return w\.toISOString\(\)\.substring\(0,10\); \}\n)+', r'\1', text, count=1)
# Restore desired state: exactly one isoDateWAT after isoDate
text = re.sub(r'(function isoDate\(d\) \{ return d\.toISOString\(\)\.substring\(0,10\); \}\n)(function isoDateWAT\(d\) \{.*?\}\n)*', r'\1function isoDateWAT(d) { const w=new Date(d.getTime()+3600000); return w.toISOString().substring(0,10); }\n', text, count=1, flags=re.DOTALL)
with open('analysis-today.js','w',encoding='utf-8') as f:
    f.write(text)
print('Done')
