> ⚠️ **DOCUMENTO PARADO — não é fonte de verdade.** Notas de Instagram de 09-Jul. Nenhum código o lê.
> A verdade viva está em `docs/ARQUITETURA.html`, `docs/PRD.md` e `CLAUDE.md`.
> Factos de negócio: `data/crm/bot-alma.md` e `data/config/delivery-zones.json`.
> (aviso posto a 2026-08-12 ao mapear o que está vivo e o que é decoração)

# ðŸ“± Superloja Auto-Poster v4.1 - Instagram Optimization Guide

**Status:** âœ… Fully Tested on Instagram - 19 Maio 2026

---

## ðŸŽ¯ Instagram Test Results Summary

### âœ… Single Post
```
Status: WORKING âœ…
Time: 3-4 seconds
Format: 1 image + caption
Result ID: 17951717862160808
```

### âœ… Carousel (5 images)
```
Status: WORKING âœ…
Time: 35-45 seconds
Format: 1 album post with 5 swipeable images
Result ID: 18124047931624597
Children: 5/5 uploaded successfully
```

### âŒ Stories
```
Status: NOT SUPPORTED âš ï¸
Reason: Instagram Business Accounts cannot post Stories via API
Limitation: Meta API restriction (personal profiles only)
Workaround: Use carousel or reels instead
```

### âœ… Reels (NEW!)
```
Status: WORKING âœ…âœ…âœ…
Time: 50-70 seconds (FFmpeg + processing)
Format: Video slideshow (8 products Ã— 2s) + Audio
Audio: Successfully muxed (AAC 128kbps)
Video codec: H.264, 1080x1080, yuv420p
Processing wait: 40 seconds (IG processing)
Result ID: 17875246122479742
Notes:
  - FFmpeg concat demuxer: PERFECT
  - Scale filter (1080x1080): Resolved all height issues
  - Upload to Catbox: Working
  - IG file_url: Accepts direct URL (no re-download)
```

---

## ðŸ“Š Instagram vs Facebook Comparison

| Feature | Facebook | Instagram | Recommendation |
|---------|----------|-----------|-----------------|
| **Single** | âœ… Works | âœ… Works | Both (simultaneous) |
| **Carousel** | âœ… Works | âœ… Works | Both (simultaneous) |
| **Stories** | âœ… Feed posts | âŒ Not supported | Use FB feed posts |
| **Reels** | âš ï¸ Video feed | âœ… Proper reels | **IG ONLY** |

---

## ðŸš€ Recommended Posting Schedule

### Option A: Balanced (All formats)
```
09:00 - Single Post (IG + FB)           - 4s total
12:00 - Carousel (IG + FB)              - 45s total
15:00 - Reels (IG only, skip FB)        - 70s total
18:00 - Single Post (IG + FB)           - 4s total

Daily workload: 2 min 3 sec
```

### Option B: Instagram Focused (Reels heavy)
```
09:00 - Single Post (IG + FB)           - 4s total
12:00 - Reels IG (skip FB)              - 70s total
15:00 - Carousel (IG + FB)              - 45s total
18:00 - Single Post (IG + FB)           - 4s total

Daily workload: 2 min 3 sec
Advantage: More Reels visibility on Instagram
```

### Option C: Facebook Stories Focus
```
09:00 - Single Post (IG + FB)           - 4s total
11:00 - Stories (FB feed posts)         - 8s total
14:00 - Carousel (IG + FB)              - 45s total
17:00 - Reels (IG only)                 - 70s total

Daily workload: 2 min 7 sec
```

---

## ðŸ”§ Implementation: Cron Schedule

```bash
# Edit crontab
crontab -e

# Add these lines:
# Single (09:00)
0 9 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js single >> C:\\superloja\\data/posting-log.txt 2>&1

# Carousel (12:00)
0 12 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js carousel >> C:\\superloja\\data/posting-log.txt 2>&1

# Reels (15:00)  
0 15 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js reels >> C:\\superloja\\data/posting-log.txt 2>&1

# Single (18:00)
0 18 * * * cd C:\\Users\\fox/webhook-server && node auto-poster-v4.js single >> C:\\superloja\\data/posting-log.txt 2>&1
```

---

## ðŸ“‹ What Was Fixed for Instagram

### Fix 1: Reels FFmpeg Encoding
**Problem:** Height not divisible by 2 (1000x1333)  
**Solution:** FFmpeg concat demuxer with scale filter to 1080x1080  
**Status:** âœ… Fixed

### Fix 2: Instagram Carousel Format
**Problem:** Should be 1 carousel album, not 5 separate posts  
**Solution:** Using `/media` endpoint with carousel object structure  
**Status:** âœ… Verified working

### Fix 3: Instagram Stories API Limitation
**Problem:** Business Accounts can't post Stories via API  
**Solution:** Documented limitation, skip for IG, use carousel/reels instead  
**Status:** âœ… Documented

### Fix 4: Video Processing Time
**Problem:** Reels weren't appearing after upload  
**Solution:** Added 40-second wait for IG video processing  
**Status:** âœ… Fixed

---

## ðŸŽ¥ Reels Technical Details

### FFmpeg Pipeline
```
1. Download 8 product images
2. Create concat demuxer input file
3. FFmpeg concat demuxer + scale filter:
   - Input: Various dimensions (1000x1333, 1200x1600, etc.)
   - Output: 1080x1080 (H.264, yuv420p)
   - Duration: 16 seconds (8 images Ã— 2s each)
4. Mux audio (AAC 128kbps)
5. Upload to Catbox (permanent URL)
6. POST to Instagram /media endpoint
7. Wait 40 seconds for IG processing
8. Check /media_publish response
```

### Performance Metrics
```
Image Download:     5-10 seconds
FFmpeg Encoding:   15-25 seconds
Audio Muxing:       5-10 seconds
Catbox Upload:      5-10 seconds
Processing Wait:   40 seconds (forced)
Total:             70-95 seconds per reel
```

---

## ðŸ“Œ Key Points for Instagram

1. **Reels are the future** - Instagram prioritizes Reels in the algorithm
   - Recommend posting Reels at least 3-4x per week
   - Best engagement: 15-30 second videos

2. **Carousel maintains engagement** - Great for product showcases
   - 5-image limit per carousel
   - Users can swipe to see all variations

3. **Single posts still important** - Building consistent presence
   - Quick to post (4 seconds)
   - Good for daily presence

4. **Stories are not available** - Meta API limitation
   - Business Pages â‰  Personal Accounts
   - Workaround: Use carousel for multiple products

---

## ðŸŽ® Manual Testing

```bash
# Test each format on Instagram

# Single
node auto-poster-v4.js single

# Carousel
node auto-poster-v4.js carousel

# Reels (Instagram only)
node auto-poster-v4.js reels

# Check logs
tail -f C:\\superloja\\data/posting-log.txt
```

---

## ðŸ“Š Dashboard Monitoring

```bash
# Start dashboard
node dashboard.js

# Access at: http://localhost:3333
# Shows:
# - Posts today (all platforms)
# - Success rate
# - Next scheduled post
# - Execution logs (real-time)
# - Checklist status (products used)
# - Posting history
```

---

## âœ… Pre-Deployment Checklist

- [x] Single posts working (IG + FB)
- [x] Carousel working (IG + FB)
- [x] Stories documented (FB alternative)
- [x] Reels fully functional (IG)
- [x] FFmpeg optimization complete
- [x] No product repetition
- [x] Real images posting
- [x] Dashboard ready
- [x] Logging comprehensive
- [x] Cron scheduling tested

---

## ðŸš€ Ready to Deploy!

**Status:** âœ… Production Ready

Next steps:
1. Run `bash setup.sh` to verify environment
2. Test one format: `node auto-poster-v4.js single`
3. Start dashboard: `node dashboard.js`
4. Setup crons: `crontab -e` (add 4 lines)
5. Monitor logs: `tail -f C:\\superloja\\data/posting-log.txt`

---

### ⚠️ Stack actualizado (Jul 2026) — consulte HERMES-INTEGRATION.md
- Domínio público: `https://superloja.cc/` (substituiu `.vip`).
- Bridge WhatsApp :3010 é obsoleto — canal agora vive no gateway `openclaw :18789`.
- Crons: `superloja-watchdog.sh` (30m) + `superloja-weekly-learn.sh` (Dom 21h) gerem saúde + aprendem com vendas SL-XXXX.

*Superloja Angola Auto-Poster - Instagram Optimized Edition 🚀*

