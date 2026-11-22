// Thought Vault tagger. Runs entirely in the browser: no server, no AI account, nothing leaves the device.
//
// Every thought gets three kinds of label:
//   1. A SHELF (one): which part of my life it belongs to. Like the colour families in Fabric Vault.
//   2. A KIND (one): what sort of thought it is: idea, to do, question, note or reflection.
//   3. TOPIC TAGS (up to 4): the specific things it's about, e.g. #christmas, #tumbler-cover, #luna-wolf.
//
// It learns: every time I file or move a thought, the words in it count towards that shelf,
// so the guesses get better the more I use it.
(function () {
  'use strict';

  // Starting shelves. They can be renamed, and keywords added, in the app under "Shelves".
  const DEFAULT_SHELVES = [
    { id: 'products', name: 'Products & designs', short: 'Products',
      words: 'product products design designs pattern patterns template templates size sizes prototype version colourway colourways collection range launch tumbler cover covers sleeve pad pads bag bags pouch pouches wrap scrunchie bundle kit sample samples mockup sketch variant new-product' },
    { id: 'making', name: 'Making & workshop', short: 'Making',
      words: 'sew sewing stitch stitching machine overlocker serger thread needle cutting cut iron interfacing seam hem binding bias quilt 3dprint printer print stl filament pla petg bambu p2s nozzle plate cad fusion tinkercad bracket jig tool tools workshop glue laser measure measurement mm cm tolerance fit' },
    { id: 'shop', name: 'Shop & orders', short: 'Shop',
      words: 'order orders customer customers client price prices pricing shipping postage delivery courier stock restock inventory supplier suppliers website shop shopify etsy shopee carousell lazada listing listings checkout review reviews refund wholesale packaging sell selling sold bestseller' },
    { id: 'popups', name: 'Pop-ups & markets', short: 'Pop-ups',
      words: 'popup popups market markets fair fairs stall booth table display banner signage float cash qr paynow card-reader visitor visitors bazaar flea weekend setup set-up tent tablecloth rack' },
    { id: 'content', name: 'Socials & content', short: 'Socials',
      words: 'instagram insta ig reel reels post posts caption captions tiktok facebook story stories photo photos photoshoot shoot video videos newsletter blog email emails hashtag hashtags follower followers content youtube pinterest copy voice' },
    { id: 'admin', name: 'Money & admin', short: 'Money',
      words: 'tax taxes gst iras accounts accountant bank receipt receipts expense expenses budget cost costs profit revenue spreadsheet bill bills insurance registration acra cpf invoice invoices subscription renew renewal' },
    { id: 'life', name: 'Home & life', short: 'Life',
      words: 'family mum mom dad husband partner kids kid son daughter home house flat doctor dentist clinic health sleep gym walk run holiday trip birthday gift friend friends groceries grocery dinner lunch cook cooking clean cleaning laundry weekend' },
    { id: 'learning', name: 'Learning & inspiration', short: 'Learning',
      words: 'book books read reading course courses class tutorial podcast article learn learned learnt inspiration inspired museum exhibition quote documentary research skill technique' },
  ];

  const KINDS = [
    { id: 'idea', name: 'Idea', plural: 'Ideas' },
    { id: 'todo', name: 'To do', plural: 'To do' },
    { id: 'question', name: 'Question', plural: 'Questions' },
    { id: 'note', name: 'Note', plural: 'Notes' },
    { id: 'reflection', name: 'Reflection', plural: 'Reflections' },
  ];

  // Specific topics worth a tag when they come up. Tags I've already used are always checked first.
  const TOPICS = {
    'christmas': 'christmas xmas', 'chinese-new-year': 'cny chinese-new-year', 'valentines': 'valentine valentines',
    'mothers-day': 'mothers-day', 'fathers-day': 'fathers-day', 'teachers-day': 'teachers-day', 'deepavali': 'deepavali diwali',
    'hari-raya': 'hari-raya raya', 'mid-autumn': 'mid-autumn mooncake',
    'tumbler-cover': 'tumbler tumblers', 'pads': 'pad pads', 'bags': 'bag bags tote totes', 'pouches': 'pouch pouches',
    'scrunchies': 'scrunchie scrunchies', 'gift-sets': 'gift-set gift-sets bundle bundles hamper',
    'fabric': 'fabric fabrics', 'cotton': 'cotton', 'linen': 'linen', 'batik': 'batik', 'canvas': 'canvas', 'elastic': 'elastic',
    'zips': 'zip zips zipper', 'velcro': 'velcro', 'packaging': 'packaging packing box boxes', 'labels': 'label labels tag-label',
    'pricing': 'price prices pricing', 'photos': 'photo photos photoshoot', 'reels': 'reel reels video videos',
    'instagram': 'instagram insta ig', 'newsletter': 'newsletter', 'website': 'website shopify',
    'shopee': 'shopee', 'carousell': 'carousell', 'etsy': 'etsy',
    '3d-printing': '3dprint stl filament bambu p2s printer', 'templates': 'template templates', 'patterns': 'pattern patterns',
    'suppliers': 'supplier suppliers', 'customers': 'customer customers', 'workshops': 'workshop-class teach teaching',
    'gst': 'gst', 'tax': 'tax taxes iras',
  };

  const STOP = new Set(('a an and are as at be been but by can could did do does doing for from get got had has have he her his how i if ' +
    'in into is it its just like me more most my no not now of on one or our out over really she so some still than that the their ' +
    'them then there these they thing things think this those to too up us very was way we were what when where which while who why ' +
    'will with would you your yes also maybe about again all am any because before being both each few go going gonna good great ' +
    'here let lot lots make made much need only other own same should since such take thought thoughts time try want well even ' +
    'ever every first last new next off once onto per quite rather said say says see seem seems shall since sort today tomorrow').split(' '));

  // Join phrases into single tokens before splitting, so "pop-up" / "pop up" / "popup" are the same word.
  const PHRASES = [
    [/\bpop[\s-]?ups?\b/g, 'popup'], [/\b3[\s-]?d[\s-]?print(ing|ed|er|s)?\b/g, '3dprint'], [/\bchinese new year\b/g, 'chinese-new-year'],
    [/\bmother'?s'? day\b/g, 'mothers-day'], [/\bfather'?s'? day\b/g, 'fathers-day'], [/\bteacher'?s'? day\b/g, 'teachers-day'],
    [/\bhari raya\b/g, 'hari-raya'], [/\bmid[\s-]autumn\b/g, 'mid-autumn'], [/\bgift sets?\b/g, 'gift-set'], [/\bcard reader\b/g, 'card-reader'],
    [/\bset[\s-]up\b/g, 'setup'], [/\bnew products?\b/g, 'new-product'],
  ];

  function stem(w) {
    if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  function prep(text) {
    let t = ' ' + String(text || '').toLowerCase().replace(/[’']/g, "'") + ' ';
    for (const [re, rep] of PHRASES) t = t.replace(re, rep);
    return t;
  }

  function tokens(text) {
    const out = [];
    for (const raw of prep(text).split(/[^a-z0-9\-]+/)) {
      const w = raw.replace(/^-+|-+$/g, '');
      if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
      out.push(stem(w));
    }
    return out;
  }

  function wordSet(str) { return new Set(String(str || '').toLowerCase().split(/[\s,]+/).filter(Boolean).map(stem)); }

  // ---- Learning from my own filing ----
  // model[token][shelfId] = how many filed thoughts on that shelf contain the token.
  function buildModel(thoughts) {
    const model = Object.create(null);
    for (const t of thoughts) {
      if (!t.shelf || t.shelfBy !== 'you') continue;
      for (const w of new Set(tokens(t.text))) {
        const row = model[w] || (model[w] = Object.create(null));
        row[t.shelf] = (row[t.shelf] || 0) + 1;
      }
    }
    return model;
  }

  // Returns { shelf, sure, scores }. shelf is '' when it can't tell, so the thought lands in Unsorted.
  function guessShelf(text, shelves, model) {
    const toks = tokens(text);
    const scores = {};
    const firstAt = {};
    for (const s of shelves) {
      const kw = s._kw || (s._kw = wordSet(s.words + ' ' + s.name));
      let n = 0;
      toks.forEach((w, i) => { if (kw.has(w)) { n += 2; if (!(s.id in firstAt)) firstAt[s.id] = i; } });
      scores[s.id] = n;
    }
    if (model) {
      for (const w of new Set(toks)) {
        const row = model[w];
        if (!row) continue;
        let sum = 0;
        for (const k in row) sum += row[k];
        // A word seen once tells us a little; a word seen on the same shelf ten times tells us a lot.
        const weight = Math.min(2.5, 0.6 + Math.log2(1 + sum) * 0.6);
        for (const k in row) if (k in scores) scores[k] += weight * (row[k] / sum);
      }
    }
    // On a tie, the shelf whose words come first wins: the subject is usually near the start.
    const at = (id) => (id in firstAt ? firstAt[id] : 1e9);
    const ranked = Object.entries(scores).sort((a, b) => (Math.abs(b[1] - a[1]) < 0.01 ? at(a[0]) - at(b[0]) : b[1] - a[1]));
    const [best, second] = [ranked[0] || ['', 0], ranked[1] || ['', 0]];
    const sure = best[1] >= 1.8 && best[1] >= second[1] * 1.25;
    return { shelf: best[1] >= 1.8 ? best[0] : '', sure, best: best[1] > 0 ? best[0] : '', scores };
  }

  // ---- Kind ----
  const RE_TODO_START = /^(?:[-*•]\s*)?(?:\[ \]\s*)?(?:todo:?|to do:?|need to|needs to|must|have to|got to|gotta|remember|don'?t forget|buy|read|watch|look into|look up|find|get|research|try out|call|email|message|text|whatsapp|book|order|reorder|restock|send|check|ask|pay|fix|finish|print|post|upload|update|reply|pick up|collect|return|cancel|renew|schedule|sort out|chase|follow up|write|draft|prep|prepare|pack|measure|test|clean|tidy|list|photograph|ship|top up)\b/i;
  const RE_TODO_ANY = /\b(need to|needs to|have to|remember to|don'?t forget|must|by (?:mon|tue|wed|thu|fri|sat|sun|tomorrow|tonight|next week|end of)|deadline|due)\b|\[ \]/i;
  const RE_IDEA = /\b(what if|idea|ideas|how about|could (?:i|make|try|do|sell|add)|maybe (?:i|make|try|do|sell|add)|might be (?:fun|nice|cool|good)|would be (?:fun|nice|cool|good|lovely|great)|wouldn'?t it be|imagine|new product|new design|version of|range of|collab|collaboration|spin[- ]off|twist on)\b/i;
  const RE_QUESTION_START = /^(how|why|what|where|when|which|who|whom|whose|should i|can i|could i|would|is it|is there|are there|does|do i|do people|will|am i|has anyone)\b/i;
  const RE_REFLECT = /\b(i feel|i felt|feeling|felt|today|yesterday|this week|last week|grateful|thankful|learn(?:ed|t)|realis(?:ed|e)|realiz(?:ed|e)|noticed|lesson|went well|didn'?t go|proud|tired|happy|sad|frustrat|pleasantly surprised|note to self|looking back|in hindsight|honestly|let'?s be honest)\b/i;

  function guessKind(text) {
    const t = String(text || '').trim();
    if (!t) return 'note';
    const first = t.split(/\n/)[0];
    if (RE_TODO_START.test(first) || RE_TODO_ANY.test(t)) return 'todo';
    if (/^what if\b/i.test(first) || /^idea\b/i.test(first)) return 'idea';
    if (/\?\s*$/.test(first) || (RE_QUESTION_START.test(first) && t.length < 200)) return 'question';
    if (RE_IDEA.test(t)) return 'idea';
    if (RE_REFLECT.test(t)) return 'reflection';
    return 'note';
  }

  // ---- Topic tags ----
  function slug(s) {
    return String(s || '').toLowerCase().replace(/^#/, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  }

  let topicIndex = null;
  function topics() {
    if (topicIndex) return topicIndex;
    topicIndex = Object.entries(TOPICS).map(([tag, words]) => [tag, wordSet(words)]);
    return topicIndex;
  }

  // existingTags: every tag already in the vault, with counts, so I reuse my own tags instead of growing near-duplicates.
  function guessTags(text, existingTags, shelf) {
    const raw = String(text || '');
    const toks = tokens(raw);
    const tokSet = new Set(toks);
    const prepped = prep(raw);
    const out = [];
    const add = (tag) => { tag = slug(tag); if (tag && tag.length > 1 && !out.includes(tag) && out.length < 4) out.push(tag); };

    // 1. Hashtags I typed myself always win.
    for (const m of raw.matchAll(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{1,29})/gu)) add(m[2]);

    // 2. Tags I've used before that appear in this thought (most-used first).
    const known = Object.entries(existingTags || {}).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    for (const tag of known) {
      const parts = tag.split('-').map(stem);
      if (parts.every((p) => tokSet.has(p)) || prepped.includes(' ' + tag.replace(/-/g, ' ') + ' ') || prepped.includes(tag)) add(tag);
    }

    // 3. Curated topics.
    for (const [tag, words] of topics()) {
      for (const w of words) if (tokSet.has(w)) { add(tag); break; }
    }

    // 4. Names: Capitalised words in the middle of a sentence ("met Sarah from Luna Wolf") are usually people, shops or fabrics.
    const names = raw.match(/(?<![.!?\n]\s*)(?<=\s)(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g) || [];
    const notNames = /^(I|I'm|I've|I'll|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|The|A|An|And|But|So|Maybe|Also|Then|Pro|OK|Ok)$/;
    for (const n of names) {
      const first = n.split(/\s+/)[0];
      if (notNames.test(first) || n.length < 3) continue;
      add(n);
    }

    // Don't tag the shelf's own name: the shelf already says that.
    return out.filter((t) => t !== shelf);
  }

  function analyse(text, ctx) {
    const shelves = (ctx && ctx.shelves) || DEFAULT_SHELVES;
    const g = guessShelf(text, shelves, ctx && ctx.model);
    return {
      shelf: g.shelf,
      shelfSure: g.sure,
      shelfHint: g.best,
      kind: guessKind(text),
      tags: guessTags(text, ctx && ctx.tagCounts, g.shelf),
    };
  }

  window.Tagger = { DEFAULT_SHELVES, KINDS, analyse, guessShelf, guessKind, guessTags, buildModel, tokens, slug };
})();
