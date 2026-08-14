#!/usr/bin/env python3
import json, os, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

ENV_PATH = Path(r"C:\superloja\webhook-server\.env")
env = {}
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

FB_PAGE_ID = env.get("FB_PAGE_ID")
FB_TOKEN = env.get("FB_PAGE_TOKEN")
IG_ACCOUNT = env.get("IG_PAGE_ID") or env.get("INSTAGRAM_ACCOUNT_ID")
IG_TOKEN = env.get("INSTAGRAM_ACCESS_TOKEN")

ANALYTICS_DIR = Path(r"C:\superloja\data\analytics")
RAW_DIR = ANALYTICS_DIR / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

TODAY = "2026-07-07"
YESTERDAY = "2026-07-06"

def api_get(url, token):
    try:
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, {"error": {"message": body[:300], "code": e.code}}
    except Exception as e:
        return 0, {"error": {"message": str(e)}}

def fetch_all_pages(start_url, token, max_pages=4):
    all_items = []
    url = start_url
    pages = 0
    while url and pages < max_pages:
        code, data = api_get(url, token)
        if "error" in data:
            print("  ERR page " + str(pages) + ": " + str(data["error"])[:200])
            break
        all_items.extend(data.get("data") or [])
        paging = data.get("paging") or {}
        url = paging.get("next")
        pages += 1
    return all_items

def calc_er(likes, comments, shares, reach):
    if not reach or reach <= 0:
        return None
    return ((likes + comments + (shares or 0)) / reach) * 100

def hour_of(iso):
    if not iso: return None
    try: return datetime.fromisoformat(iso.replace("Z", "+00:00")).hour
    except: return None

def day_of(iso):
    return iso[:10] if iso else None

print("=" * 60)
print("FACEBOOK COLLECTION")
print("=" * 60)
fb_url = ("https://graph.facebook.com/v25.0/" + FB_PAGE_ID + "/posts?fields=id,message,created_time,permalink_url,status_type,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)&limit=25")
fb_posts = fetch_all_pages(fb_url, FB_TOKEN)
print("FB posts fetched:", len(fb_posts))

for p in fb_posts:
    u = "https://graph.facebook.com/v25.0/" + p["id"] + "/insights?metric=post_fan_reach,post_reactions_by_type_total,post_reactions_like_total,post_clicks,post_reactions_love_total,post_reactions_wow_total"
    code, r = api_get(u, FB_TOKEN)
    if "error" in r:
        p["_insights_err"] = r["error"].get("message")
        continue
    d = {x["name"]: (x.get("values") or [{}])[0].get("value", 0) for x in r.get("data", [])}
    p["reach"] = int(d.get("post_fan_reach", 0) or 0)
    p["impressions"] = int(d.get("post_clicks", 0) or 0)
    p["engaged_users"] = 0
    p["reactions"] = d.get("post_reactions_by_type_total", {}) or {}
    p["reactions_total"] = sum((p["reactions"] or {}).values()) if isinstance(p["reactions"], dict) else 0

print()
print("=" * 60)
print("INSTAGRAM COLLECTION")
print("=" * 60)
code, ig_acct = api_get("https://graph.facebook.com/v25.0/" + IG_ACCOUNT + "?fields=id,username,media_count,followers_count,follows_count", IG_TOKEN)
print("IG account:", ig_acct)
ig_url = ("https://graph.facebook.com/v25.0/" + IG_ACCOUNT + "/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count&limit=25")
ig_media = fetch_all_pages(ig_url, IG_TOKEN)
print("IG media fetched:", len(ig_media))

for m in ig_media:
    ins_url = "https://graph.facebook.com/v25.0/" + m["id"] + "/insights?metric=reach,total_interactions,saved,likes,comments,shares,profile_visits,follows"
    code, r = api_get(ins_url, IG_TOKEN)
    if "error" in r:
        m["_err"] = r["error"].get("message")
        continue
    d = {x["name"]: (x.get("values") or [{}])[0].get("value", 0) for x in r.get("data", [])}
    m["reach"] = int(d.get("reach", 0) or 0)
    m["impressions"] = int(d.get("total_interactions", 0) or 0)
    m["engagement"] = int(d.get("total_interactions", 0) or 0)
    m["saved"] = int(d.get("saved", 0) or 0)
    m["ig_likes"] = int(d.get("likes", 0) or 0)
    m["ig_comments"] = int(d.get("comments", 0) or 0)
    m["ig_shares"] = int(d.get("shares", 0) or 0)

raw_file = RAW_DIR / ("combined_" + TODAY + ".json")
raw_file.write_text(json.dumps({"date": TODAY, "fb": fb_posts, "ig": {"account": ig_acct, "media": ig_media}}, indent=2, ensure_ascii=False), encoding="utf-8")
print()
print("Raw saved:", raw_file)

fb_rows = []
for p in fb_posts:
    likes = ((p.get("reactions") or {}).get("summary") or {}).get("total_count", 0) or 0
    comments = ((p.get("comments") or {}).get("summary") or {}).get("total_count", 0) or 0
    shares = (p.get("shares") or {}).get("count", 0) or 0
    reach = p.get("reach", 0) or 0
    impr = p.get("impressions", 0) or 0
    engU = p.get("engaged_users", 0) or 0
    reactions_total = p.get("reactions_total", 0) or 0
    fb_rows.append({
        "id": p["id"], "date": day_of(p.get("created_time")), "hour": hour_of(p.get("created_time")),
        "type": p.get("status_type"), "likes": reactions_total, "comments": comments, "shares": shares,
        "reach": reach, "impr": impr, "engU": engU, "er": calc_er(reactions_total, comments, shares, reach),
        "msg": (p.get("message") or "")[:60],
    })

ig_rows = []
for m in ig_media:
    likes = m.get("like_count", 0) or 0
    comments = m.get("comments_count", 0) or 0
    reach = m.get("reach", 0) or 0
    impr = m.get("impressions", 0) or 0
    eng = m.get("engagement", 0) or 0
    ig_shares = m.get("ig_shares", 0) or 0
    ig_rows.append({
        "id": m["id"], "date": day_of(m.get("timestamp")), "hour": hour_of(m.get("timestamp")),
        "type": m.get("media_type"), "likes": likes, "comments": comments, "shares": ig_shares,
        "reach": reach, "impr": impr, "eng": eng, "er": calc_er(likes, comments, ig_shares, reach),
        "cap": (m.get("caption") or "")[:60],
    })

def stats(rows):
    with_er = [r for r in rows if r["er"] is not None and r["reach"] > 0]
    return {
        "count": len(rows),
        "reach": sum(r.get("reach") or 0 for r in rows),
        "impr": sum(r.get("impr") or 0 for r in rows),
        "likes": sum(r.get("likes") or 0 for r in rows),
        "comments": sum(r.get("comments") or 0 for r in rows),
        "shares": sum(r.get("shares") or 0 for r in rows),
        "avgER": (sum(r["er"] for r in with_er) / len(with_er)) if with_er else None,
        "posts_with_reach": len(with_er),
    }

def by_type(rows, tf):
    m = {}
    for r in rows:
        t = r.get(tf) or "UNKNOWN"
        if t not in m:
            m[t] = {"count": 0, "reach": 0, "likes": 0, "comments": 0, "shares": 0, "_ers": []}
        m[t]["count"] += 1
        m[t]["reach"] += r.get("reach") or 0
        m[t]["likes"] += r.get("likes") or 0
        m[t]["comments"] += r.get("comments") or 0
        m[t]["shares"] += r.get("shares") or 0
        if r["er"] is not None and r["reach"] > 0:
            m[t]["_ers"].append(r["er"])
    out = []
    for k, v in m.items():
        avg_er = sum(v["_ers"]) / len(v["_ers"]) if v["_ers"] else None
        out.append({"type": k, "count": v["count"], "reach": v["reach"], "likes": v["likes"], "comments": v["comments"], "shares": v["shares"], "avgER": avg_er})
    return sorted(out, key=lambda x: (x["avgER"] or 0), reverse=True)

def by_hour(rows):
    m = {}
    for r in rows:
        h = r.get("hour")
        if h is None: continue
        if h not in m:
            m[h] = {"count": 0, "reach": 0, "likes": 0, "comments": 0, "shares": 0, "_ers": []}
        m[h]["count"] += 1
        m[h]["reach"] += r.get("reach") or 0
        m[h]["likes"] += r.get("likes") or 0
        m[h]["comments"] += r.get("comments") or 0
        m[h]["shares"] += r.get("shares") or 0
        if r["er"] is not None and r["reach"] > 0:
            m[h]["_ers"].append(r["er"])
    out = []
    for k, v in m.items():
        avg_er = sum(v["_ers"]) / len(v["_ers"]) if v["_ers"] else None
        out.append({"hour": int(k), "count": v["count"], "reach": v["reach"], "likes": v["likes"], "comments": v["comments"], "shares": v["shares"], "avgER": avg_er})
    return sorted(out, key=lambda x: x["hour"])

def by_day(rows):
    m = {}
    for r in rows:
        d = r.get("date")
        if not d: continue
        if d not in m:
            m[d] = {"count": 0, "reach": 0, "likes": 0, "comments": 0, "shares": 0, "_ers": []}
        m[d]["count"] += 1
        m[d]["reach"] += r.get("reach") or 0
        m[d]["likes"] += r.get("likes") or 0
        m[d]["comments"] += r.get("comments") or 0
        m[d]["shares"] += r.get("shares") or 0
        if r["er"] is not None and r["reach"] > 0:
            m[d]["_ers"].append(r["er"])
    out = []
    for k, v in m.items():
        avg_er = sum(v["_ers"]) / len(v["_ers"]) if v["_ers"] else None
        out.append({"date": k, "count": v["count"], "reach": v["reach"], "likes": v["likes"], "comments": v["comments"], "shares": v["shares"], "avgER": avg_er})
    return sorted(out, key=lambda x: x["date"])

fb_stats = stats(fb_rows)
ig_stats = stats(ig_rows)
fb_by_type = by_type(fb_rows, "type")
ig_by_type = by_type(ig_rows, "type")
fb_by_hour = by_hour(fb_rows)
ig_by_hour = by_hour(ig_rows)
fb_by_day = by_day(fb_rows)
ig_by_day = by_day(ig_rows)

yesterday_path = ANALYTICS_DIR / ("report_" + YESTERDAY + ".json")
yesterday = None
if yesterday_path.exists():
    try: yesterday = json.loads(yesterday_path.read_text(encoding="utf-8"))
    except: yesterday = None

fb_top = sorted([r for r in fb_rows if r["reach"] > 0], key=lambda x: (x["er"] or 0), reverse=True)[:10]
ig_top = sorted([r for r in ig_rows if r["reach"] > 0], key=lambda x: (x["er"] or 0), reverse=True)[:10]

recs = []

if fb_by_hour:
    best_fb = sorted(fb_by_hour, key=lambda h: (h["avgER"] or 0), reverse=True)[:3]
    recs.append({"priority": "CRITICAL", "area": "HORARIOS FACEBOOK", "finding": "Top 3 horas FB por engagement rate", "data": [str(h["hour"]) + "h WAT (" + ("%.2f" % (h["avgER"] or 0)) + "% ER, " + str(h["count"]) + " posts)" for h in best_fb], "action": "Concentrar cron jobs nestas horas"})

if ig_by_hour:
    best_ig = sorted(ig_by_hour, key=lambda h: (h["avgER"] or 0), reverse=True)[:3]
    recs.append({"priority": "CRITICAL", "area": "HORARIOS INSTAGRAM", "finding": "Top 3 horas IG por engagement rate", "data": [str(h["hour"]) + "h WAT (" + ("%.2f" % (h["avgER"] or 0)) + "% ER, " + str(h["count"]) + " posts)" for h in best_ig], "action": "Publicar nos horarios de pico"})

if fb_by_type:
    recs.append({"priority": "HIGH", "area": "FORMATOS FACEBOOK", "finding": "Performance por tipo de post", "data": [t["type"] + ": " + str(t["count"]) + " posts, ER " + ("%.2f" % (t["avgER"] or 0)) + "%, reach " + str(t["reach"]) for t in fb_by_type], "action": "Aumentar frequencia do tipo com melhor ER"})

if ig_by_type:
    recs.append({"priority": "HIGH", "area": "FORMATOS INSTAGRAM", "finding": "Performance por media type", "data": [t["type"] + ": " + str(t["count"]) + " posts, ER " + ("%.2f" % (t["avgER"] or 0)) + "%, reach " + str(t["reach"]) for t in ig_by_type], "action": "Aumentar frequencia do tipo com melhor ER (CAROUSEL/VIDEO/IMAGE)"})

if fb_stats["avgER"] is not None and fb_stats["avgER"] < 1:
    recs.append({"priority": "CRITICAL", "area": "CTA FRACO FACEBOOK", "finding": "ER medio FB = " + ("%.3f" % fb_stats["avgER"]) + "% (benchmark: >1%)", "data": [], "action": "CTAs diretos: Encomenda agora, Chama no DM, Link na bio"})
if ig_stats["avgER"] is not None and ig_stats["avgER"] < 1:
    recs.append({"priority": "CRITICAL", "area": "CTA FRACO INSTAGRAM", "finding": "ER medio IG = " + ("%.3f" % ig_stats["avgER"]) + "% (benchmark: >1%)", "data": [], "action": "Stories + Reels tem ER 3-5x maior. Investir."})

recs.append({"priority": "HIGH", "area": "VOLUME", "finding": "FB " + str(len(fb_rows)) + " posts, IG " + str(len(ig_rows)) + " media nos ultimos ~25 dias", "data": ["FB: " + ("%.1f" % (len(fb_rows)/25)) + " posts/dia", "IG: " + ("%.1f" % (len(ig_rows)/25)) + " media/dia"], "action": "Angola mercado pequeno: 1-2 posts/dia FB, 1-2 IG + Stories + Reels 2-3x semana"})

fb_promo = [r for r in fb_rows if "Promo" in (r.get("msg") or "")]
if fb_promo:
    recs.append({"priority": "MEDIUM", "area": "CONTEUDO REPETITIVO", "finding": str(len(fb_promo)) + " de " + str(len(fb_rows)) + " posts FB sao template Promocoes do dia", "data": [], "action": "Variacao: unboxings, depoimentos, before/after, dicas de uso"})

ig_reels = [r for r in ig_rows if r.get("type") == "VIDEO"]
if len(ig_reels) < 5:
    recs.append({"priority": "HIGH", "area": "POUCO REELS/STORIES", "finding": "Apenas " + str(len(ig_reels)) + " Reels/videos nos ultimos 100 media IG", "data": [], "action": "Reels tem alcance organico 3-5x maior. Minimo 2-3 Reels/semana."})

report = {"generated_at": datetime.now(timezone.utc).isoformat(), "date": TODAY, "page": {"fb_id": FB_PAGE_ID, "ig": ig_acct}, "summary": {"fb": fb_stats, "ig": ig_stats}, "by_type": {"fb": fb_by_type, "ig": ig_by_type}, "by_hour": {"fb": fb_by_hour, "ig": ig_by_hour}, "by_day": {"fb": fb_by_day, "ig": ig_by_day}, "top_posts": {"fb": fb_top, "ig": ig_top}, "comparison_with_yesterday": yesterday, "recommendations": recs}
report_file = ANALYTICS_DIR / ("report_" + TODAY + ".json")
report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

print()
print("=" * 60)
print("FINAL REPORT")
print("=" * 60)
print("Saved:", report_file)
print()
print("--- FB SUMMARY ---")
print(json.dumps(fb_stats, indent=2, ensure_ascii=False))
print()
print("--- IG SUMMARY ---")
print(json.dumps(ig_stats, indent=2, ensure_ascii=False))
print()
print("--- FB BY TYPE ---")
print(json.dumps(fb_by_type, indent=2, ensure_ascii=False))
print()
print("--- IG BY TYPE ---")
print(json.dumps(ig_by_type, indent=2, ensure_ascii=False))
print()
print("--- FB BY HOUR (only with reach) ---")
fb_hr_with = [h for h in fb_by_hour if h["reach"] > 0]
print(json.dumps(fb_hr_with, indent=2, ensure_ascii=False))
print()
print("--- IG BY HOUR (only with reach) ---")
ig_hr_with = [h for h in ig_by_hour if h["reach"] > 0]
print(json.dumps(ig_hr_with, indent=2, ensure_ascii=False))
print()
print("--- FB BY DAY (last 10) ---")
print(json.dumps(fb_by_day[-10:], indent=2, ensure_ascii=False))
print()
print("--- IG BY DAY (last 10) ---")
print(json.dumps(ig_by_day[-10:], indent=2, ensure_ascii=False))
print()
print("--- FB TOP 10 ---")
print(json.dumps(fb_top, indent=2, ensure_ascii=False))
print()
print("--- IG TOP 10 ---")
print(json.dumps(ig_top, indent=2, ensure_ascii=False))
print()
print("--- RECOMMENDATIONS ---")
print(json.dumps(recs, indent=2, ensure_ascii=False))
