# WebTerm

تيرمينال بيشتغل جوه المتصفح (على GitHub Pages)، مبني من الصفر بـ JavaScript.

- نظام ملفات حقيقي بيتخزن في المتصفح (IndexedDB) ويفضل بعد إغلاق الصفحة
- `git clone` من GitHub (isomorphic-git)
- `python` و `pip install` (Pyodide)
- `node` لتشغيل JS بسيط، و `open` لتشغيل صفحات HTML
- `nano` محرر، `download` و `upload` و `wget` و `curl`
- شريط مفاتيح (ESC, TAB, ^C, الأسهم) زي تيرميكس

## الرفع
ارفع `index.html` و `term.js` و `README.md` في Repository جديد (مثلًا `web-term`) وفعّل Pages من Settings.

## حدود
ده مش Linux حقيقي: مفيش apt ولا bash ولا Node حقيقي. الاتصال بالإنترنت محكوم بـ CORS،
و `git clone` بيمر على بروكسي `cors.isomorphic-git.org` العام (ممكن يبطأ أو يتوقف).
