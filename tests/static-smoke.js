const fs=require("fs"),vm=require("vm"),assert=require("assert");
const html=fs.readFileSync("index.html","utf8").replace(/\r\n/g,"\n");
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());
assert(scripts.length>=3,"inline scripts missing");
scripts.forEach((code,i)=>{assert.doesNotThrow(()=>new vm.Script(code,{filename:"sparkorb-inline-"+(i+1)+".js"}),"inline script "+(i+1)+" syntax");});
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.strictEqual(new Set(ids).size,ids.length,"duplicate HTML ids");
["productInput","addBtn","compareBtn","demoListBtn","list","stores","results","receiptFile","receiptStore","receiptDate","finishPurchaseBtn","reviewRows","ocrStatus","receiptTotalCheck","receiptStoreDetail","receiptPaymentDetail","receiptInsight","receiptInsightTitle","statsAverage","statsBreakdown","statsTrend","statsDiscoveries","statsRecent","statsInsight","feedbackText","feedbackSend","feedbackStatus","homePulse","homePulseTitle","homePulseDetail"].forEach(id=>assert(ids.includes(id),"missing required element #"+id));
assert(!html.includes('addEventListener("click",compareStable)'),"legacy compare engine is still bound");
assert(!html.includes('var demo=byId("demoListBtn")'),"obsolete demo handler is still bound");
assert(html.includes("window.addSparkorbItem"),"single-basket bridge missing");
assert(html.includes("window.replaceSparkorbList"),"saved-list bridge missing");
assert(html.includes("rawForAmount"),"decimal-comma quantity parser missing");
assert(html.includes('|stk|pcs?|x|packungen?|packs?'),"shopping quantity parser should accept pc/pcs piece notation");
assert(html.includes("receiptCandidateScore"),"multi-pass receipt scoring missing");
assert(html.includes('\\b(\\d{2})\\s+(\\d{2})\\s+(20\\d{2}|\\d{2})\\b'),"receipt date parser should recover dates when OCR drops separators");
assert(!html.includes('label for="receiptTotalInput"'),"manual receipt-total editor must stay hidden");
assert.strictEqual((html.match(/function importRecipeIngredients\s*\(/g)||[]).length,1,"recipe import must have one implementation");
assert(html.includes("plausibleReceiptItemName"),"receipt item plausibility guard missing");
const itemNameGuardStart=html.indexOf("function plausibleReceiptItemName(name)"),itemNameGuardEnd=html.indexOf("function receiptRecognizedTotal",itemNameGuardStart),itemNameGuardBlock=html.slice(itemNameGuardStart,itemNameGuardEnd);
assert(itemNameGuardStart>=0&&itemNameGuardBlock.includes("endsumme|rechnungsbetrag|betrag fällig|betrag faellig")&&itemNameGuardBlock.includes("gegeben|bezahlt|erhalten|betrag erhalten"),"receipt item-name filter should reject expanded total and payment labels");
assert(html.includes("comparisonQuality"),"comparison confidence labelling missing");
assert(!html.includes("compareStable"),"obsolete duplicate comparison engine must stay removed");
assert(html.includes('history.sort((a,b)=>String(b.date).localeCompare(String(a.date))||Number(b.trust||0)-Number(a.trust||0)||a.price-b.price)'),"historical fallback must prioritize freshness and trust");
assert(html.includes("sparkorb_openprices_sync_by_key_v3"),"Open Prices should be cached per product and location scope");
assert(html.includes("const keys=[...new Set(basket.map(w=>w.key).filter(Boolean))]"),"manual compare should derive and deduplicate basket price categories");
assert(!html.includes("syncSharedData();ingestOpenPrices();"),"startup must not fetch the full Open Prices catalog");
assert(html.includes('<script src="app/config.js"></script>'),"store-ready config layer missing");
assert(html.includes('<script src="app/runtime.js"></script>'),"platform runtime layer missing");
assert(html.includes("window.SparkorbRuntime"),"location flow must use the platform runtime");
assert(html.includes('href="privacy.html"'),"privacy entry point missing");
assert(html.includes('rel="manifest"'),"installable web-app manifest missing");
assert(html.includes('apple-mobile-web-app-capable'),"iOS home-screen metadata missing");
assert(html.indexOf('id="homePlan"')<html.indexOf('id="homeReceipt"'),"shopping list should be the primary home action");
assert(html.includes("Beleg scannen"),"secondary receipt action must remain available");
assert(html.includes("function buildReceiptInsight"),"personal receipt insight engine missing");
assert(html.includes("function renderStatsBreakdown"),"monthly spending breakdown missing");
assert(html.includes("sicher kategorisiert"),"spending breakdown confidence coverage missing");
assert(html.includes('x.category!=="Sonstiges"'),"uncertain categories must not drive post-scan category facts");
assert(html.includes("sparkorb_insight_history_v1"),"personal insight history missing");
assert(html.includes("function renderStatsCategoryChanges"),"monthly category-change analysis missing");
assert(html.includes("function renderStatsYearTrend"),"fair year-to-date comparison missing");
assert(html.includes('id="statsMore"'),"advanced statistics should be grouped for mobile readability");
assert(html.includes('id="verifiedSavings" style="display:none"')&&html.includes('verified.length>=2&&difference>0.01'),"unverified model differences must not be shown as savings");
assert(html.includes("function renderStatsMarketProfile"),"personal market profile missing");
assert(html.includes('<details><summary style="cursor:pointer;font-weight:900">Meine Märkte'),"secondary market analytics should stay compact");
assert(html.includes('x.category==="Sonstiges"'),"uncertain categories should be filtered from trend drivers");
assert(html.includes("function renderStatsPriceMemory"),"personal product price memory missing");
assert(html.includes("function renderStatsRhythm"),"personal shopping rhythm analysis missing");
assert(html.includes("function searchPersonalPurchases"),"personal purchase search missing");
assert(html.includes("function renderPurchaseSearch"),"personal purchase search renderer missing");
assert(html.includes("purchase-rhythm"),"post-scan rhythm insight missing");
assert(html.includes("top-item-share"),"dominant receipt-item insight missing");
assert(html.includes("gleiche")||html.includes("identisch"),"market profile must explain direct-product comparison");
assert(html.includes("function renderStatsTrend"),"month-over-month shopping trend missing");
assert(html.includes("function renderHomePulse"),"personal home pulse missing");
assert(html.includes('API_BASE+"/v1/feedback"'),"tester feedback endpoint is not wired into the UI");
assert(html.includes('id="receiptAiButton"')&&html.includes("Foto wird an OpenAI gesendet"),"receipt AI fallback must disclose external image processing before the user taps");
assert(html.includes('/v1/receipt-vision/status'),"receipt AI button must stay hidden until backend vision is configured");
assert(html.includes("sparkorb_feedback_queue_v1"),"offline feedback queue missing");
assert(html.includes("flushFeedbackQueue"),"queued feedback retry missing");
assert(html.includes("items:valid.map"),"local receipt history must retain line items for future insights");
assert(html.includes("typicalQty=medianNumber(priorQty)"),"household forecast must normalize latest quantity against typical purchase quantity");
assert(html.includes("if(storeCanCarry(store,wish,key))"),"primary price comparison must enforce retailer assortment");
assert(html.includes("reward.ok&&!reward.duplicate&&receiptTotalVerified"),"duplicate or server-unverified receipts must never contribute market prices");
assert(html.includes("Number(r.packAmount||0)*(Number(r.count)||1)"),"multipack receipt observations must normalize by total purchased quantity");
assert(html.includes("lineTotal:Number(x.price)||0,price:Number(x.price)||0,count:Number(x.count)||1"),"receipt sync must preserve line total so multipacks are not divided twice after reload");
assert(html.includes("globalAdjustments=receiptDraft.filter"),"coupon receipts must not produce misleading cross-store savings");
assert(html.includes("plausibleObservationPrice(x)"),"trusted prices must reject implausible price outliers");
assert(html.includes("x.per!==catalog[x.key].unit"),"price observations with the wrong comparison unit must be rejected");
assert(html.includes("function exactBrandFallbackPrice"),"cold-start exact-brand orientation is missing");
assert(html.includes('referenceType:"brand-estimate"'),"estimated exact-brand prices must be explicitly labeled");
assert(html.includes('referenceType:"brand-estimate"')&&html.includes('confidence:"niedrig"'),"cold-start price orientation must remain explicitly low-confidence");
assert(html.includes("storeCanCarry(store,wish,key)"),"basket comparisons must continue to enforce store assortment eligibility");
assert(html.includes('type:"first-receipt-fact"'),"first receipt should produce an immediate useful fact");
assert(html.includes("function receiptMarketComparison")&&html.includes('currentReceiptSavingConfidence="hoch"'),"receipt markets must be compared item by item and savings kept to evidenced prices");
assert(html.includes("async function finalizeScannedReceipt")&&html.includes('$("finishPurchaseBtn").onclick=finalizeScannedReceipt'),"verified receipt scans must retain a direct single-action save path");
assert(html.includes("Beleg-Gesamtsumme")&&html.includes("analysisPartialRow"),"receipt total and honest partial savings must be visible in the analysis");
assert(!html.includes('id="contribute"')&&html.includes('id="pointsContribute"'),"sharing preference must stay out of the scan result and remain manageable in settings");
assert(html.includes(".slice(0,3)")&&html.includes("receipt-top-market"),"receipt results must show no more than the three cheapest lower estimates");
assert(html.includes("combineReceiptCandidates")&&html.includes(".96,.48")&&html.includes(".96,.30"),"receipt OCR must inspect overlapping bands through the bottom of the receipt");
assert(html.includes("const pending=Promise.allSettled")&&html.includes("comparisonRefreshPromise=pending")&&html.includes("comparisonRefreshPromise===pending"),"shopping comparison should render cache-first without an older refresh clearing a newer one");
assert(html.includes("await loadCanonicalComparison(compareBasket")&&html.includes('<script src="app/current-price-client.js"></script>'),"basket comparison must use the canonical server price client");
assert(html.includes("comparisonRefreshPromise"),"concurrent background comparison refreshes should be deduplicated");
assert(html.includes("sparkorb_nearby_store_cache_v1"),"nearby stores should persist across sessions for fast repeat comparisons");



const cat=(html.match(/openPricesCategory:/g)||[]).length;assert(cat>=15,"too few live Open Prices categories: "+cat);
const products=(html.match(/label:"/g)||[]).length;assert(products>=30,"primary product catalog unexpectedly small: "+products);
assert(!html.includes("stableBasket"),"obsolete duplicate basket state must stay removed");
assert(html.includes("if(dataEngineCache&&dataEngineCacheDay===today)return dataEngineCache"),"normalized observation engine should be cached only for the current day");
assert(html.includes("priceLookupMemo"),"basket price lookups should be memoized within a comparison");

// v7.208 regression contract: preserve the compact accordion planner the mobile UI now depends on.
assert(html.includes('body.subview .home-main-actions{display:grid!important}'),"subview must keep the three main accordion actions visible");
assert(html.includes('.home-main-actions .homeaction[aria-expanded="true"]'),"active accordion action styling missing");
assert(html.includes('grid-template-columns:22px minmax(0,1fr) auto 16px!important'),"planner row must keep a bounded mobile grid");
assert(html.includes('#planner .qty-stepper .qty-buttons button{width:27px!important;height:27px!important'),"compact quantity controls regressed");
assert(html.includes('#planner .pack-count{display:inline-flex!important'),"visible quantity count missing");
assert(html.includes('#planner #list{contain:layout style!important}'),"long-list layout containment missing");
assert(html.includes('content-visibility:auto;contain-intrinsic-size:50px'),"long shopping lists should retain viewport rendering optimization");
assert(html.includes('list-undo-toast'),"destructive list actions must retain undo affordance");
assert(html.includes('id="receiptCameraFile"'),"camera receipt input missing");
assert(html.includes('id="receiptFile" type="file" accept="image/*,application/pdf" multiple'),"gallery/PDF receipt input missing");
assert(html.includes('accordionNavigation:["homeReceipt","homePlan","homeStats"].every'),"runtime health check must verify accordion navigation");
assert(html.includes("plannerViewport:!!document.querySelector('meta[name=\"viewport\"]')".replaceAll("\\\"","\"")),"runtime health check must verify planner viewport shell");
const visibleVersion=html.match(/<span class="version">v(\d+\.\d+)\.\d+ RC<\/span>/);
assert(visibleVersion&&html.includes('version:"'+visibleVersion[1]+'"'),"visible and health-check versions must stay aligned");

console.log("static smoke OK · scripts="+scripts.length+" · catalog labels="+products+" · Open Prices categories="+cat);

assert(!html.includes("anonymisierte Preisbeobachtungen"),"price observations must not be described as anonymous");
assert(html.includes("Noch ohne Login oder Synchronisierung zwischen Geräten"),"alpha profile must disclose the lack of accounts and device sync");
const privacy=fs.readFileSync("privacy.html","utf8");
assert(!privacy.includes("in der Bon-Analyse"),"privacy settings location must match the current UI");
assert(privacy.includes("im Profil unter „Meine Belege &amp; Privatsphäre“"),"privacy notice must point to the actual sharing settings");
assert(html.includes('API_BASE+"/v1/aliases"')&&html.includes("function applyCommunityAliases"),"shared receipt aliases should feed product recognition");

assert(html.includes('id="receiptFile" type="file" accept="image/*,application/pdf" multiple'),"long receipts should accept multiple photos");

assert(html.includes('itemsComplete:!!receiptArithmeticVerified'),"saved receipts must persist whether item arithmetic is complete");
assert(html.includes('unassignedAmount:receiptArithmeticVerified?0:'),"partial receipts must persist an unassigned amount");
assert(html.includes('Artikelliste möglicherweise unvollständig'),"AI receipt flow must disclose partial item recognition");

assert(html.includes('erkannten Artikel-Ausgaben'),"category insights must be based on recognized item spend");
assert(html.includes('die kcal-Zahl beschreibt ausdrücklich nur den erkannten Teil des Einkaufs'),"calorie insight must disclose partial receipt coverage");
assert(html.includes('itemsComplete:!!receiptArithmeticVerified')&&html.includes('id:"preview"'),"receipt preview must carry completeness metadata");

assert(html.includes('type:"receipt-coverage"')&&html.includes('noch nicht einzelnen Artikeln zugeordnet'),"partial receipts should generate a transparent coverage insight");
assert(html.includes('type:"cost-concentration"'),"receipt insights should detect concentrated spending");
assert(html.includes('im Schnitt "+eur(avg)+" pro Einkauf'),"monthly receipt insight should include average basket value");

assert(html.includes('type:"favorite-store"')&&html.includes('type:"favorite-product"'),"stats profile should learn recurring stores and products");
assert(html.includes('type:"personal-price-move"')&&html.includes('keine allgemeine Marktpreisaussage'),"personal price movement insight must stay scoped to user receipts");
assert(html.includes('type:"shopping-day"')&&html.includes('type:"category-spend"'),"stats profile should learn shopping day and category patterns");
assert(html.includes('sparkorb_recent_stats_insights_v1'),"stats insights should rotate instead of showing the same fact every time");

assert(html.includes('Datenabdeckung')&&html.includes('deiner Monatsausgaben sind Einzelpositionen zugeordnet'),"monthly breakdown must disclose receipt item coverage");
assert(html.includes('Gesamtausgaben')&&html.includes('noch nicht einzelnen Artikeln zugeordnet'),"monthly breakdown must separate total spend from recognized item spend");
assert(html.includes('Kategorie-Prozente beziehen sich auf'),"category percentages must disclose their recognized-spend denominator");

assert(html.includes('type:"personal-low-price"')&&html.includes('Persönlicher Tiefpreis'),"receipt insights should flag a new personal low price");
assert(html.includes('type:"personal-high-price"')&&html.includes('Persönlicher Höchstpreis'),"receipt insights should flag a new personal high price");
assert(html.includes('prev.forEach(r=>(r.items||[])'),"current receipt must not be included in its own price history");
assert(html.includes('beim letzten vergleichbaren Kauf'),"receipt price comparison should use prior comparable purchase");

assert(html.includes('type:"personal-saving"')&&html.includes('Preisunterschied'),"receipt insight should calculate savings from the user own cross-store history");
assert(html.includes('Das ist dein eigener Preisverlauf, kein aktuelles Marktangebot.'),"historical personal savings must not be presented as current market availability");
assert(html.includes('x.store&&x.store!==current.store'),"personal savings comparison must use a different prior store");

assert(html.includes('coverage>=.7&&currentCoverage>=.8'),"receipt savings claim must require at least 70% basket-value and 80% current-price coverage");
assert(html.includes('Nur ausreichend aktuelle, nicht bloß historische/Richtwert-Preise'),"receipt analysis must explain current-price quality gate");
assert(html.includes('deshalb zeigt Caddy noch keine Warenkorb-Ersparnis'),"weak partial comparisons must not claim basket savings");

assert(html.includes('id="statsSavingsEvidence"'),"stats should expose evidence-aware savings section");
assert(html.includes('currentReceiptSavingMeta={store:best.store'),"receipt savings must persist comparison evidence metadata");
assert(html.includes('Bonwert vergleichbar')||html.includes('des Bonwerts vergleichbar'),"receipt comparison should visibly disclose basket coverage");
assert(html.includes('currentReceiptSavingConfidence')&&html.includes('savingConfidence:'),"qualified comparisons should persist confidence metadata");
assert(html.includes('Das ist keine garantierte Ersparnis'),"savings statistics must not present historical comparison totals as guaranteed savings");

assert(html.includes('id="receiptSavingDrivers"')&&html.includes('Was den Preisunterschied ausmacht'),"receipt analysis should explain savings at item level");
assert(html.includes('drivers:drivers.slice(0,8)'),"receipt savings evidence should persist item-level drivers");
assert(html.includes('id="statsSavingDrivers"')&&html.includes('Welche Produkte treiben deine Preisunterschiede?'),"stats should aggregate recurring savings drivers");
assert(html.includes('historische Vergleichsunterschiede, keine garantierte künftige Ersparnis'),"driver statistics must disclose historical scope");

assert(html.includes('id="receiptDiagnosis"')&&html.includes('EINKAUFSDIAGNOSE'),"receipt should show a unified shopping diagnosis");
assert(html.includes('function renderReceiptDiagnosis(current)'),"shopping diagnosis renderer must exist");
assert(html.includes('Kostentreiber')&&html.includes('Bonwert-Abdeckung'),"shopping diagnosis must explain cost driver and comparison coverage");
assert(html.includes('id="statsMonthlyAnomaly"')&&html.includes('Monats-Ausreißer'),"stats should detect meaningful monthly spending anomalies");
assert(html.includes('delta>=10')&&html.includes('pct>=25'),"category anomaly should require meaningful absolute and relative movement");

assert(html.includes('id="receiptBasketStory"')&&html.includes('DEIN WARENKORB'),"receipt should classify the current basket");
assert(html.includes('bekannte Produkte')&&html.includes('neu in deinem Preisgedächtnis'),"receipt story should distinguish repeat and new products");
assert(html.includes('id="statsMonthStory"')&&html.includes('Dein Monat in einem Satz'),"stats should summarize the month in plain language");
assert(html.includes('id="statsRepeatProfile"')&&html.includes('Routine oder Entdecken?'),"stats should expose repeat versus discovery behavior");
assert(html.includes('id="statsLikelyNeeds"')&&html.includes('Könnte bald wieder nötig sein'),"stats should cautiously predict recurring purchase needs");
assert(html.includes('cv>.55||ratio<.8'),"need prediction must reject irregular or premature purchase patterns");
assert(html.includes('Nur eine Prognose aus deinen eigenen Kaufabständen. Du entscheidest selbst, was auf die Liste kommt.'),"need predictions must remain suggestions rather than silent list mutations");

assert(html.includes('data-need-add')&&html.includes('+ Liste'),"recurring need predictions should be explicitly addable to the shopping list");
assert(html.includes('dein Tiefpreis')&&html.includes('zuletzt '+"'"+'+eur(x.last.price)'),"need suggestions should include personal price memory");
assert(html.includes('Du entscheidest selbst, was auf die Liste kommt.'),"smart list suggestions must remain user controlled");

assert(html.includes('sparkorb_open_purchase_plan_v1')&&html.includes('saveOpenPurchasePlan'),"price comparison should preserve the planned basket for later receipt reconciliation");
assert(html.includes('PLAN VS. WIRKLICHKEIT')&&html.includes('buildPlanVsReceipt'),"receipt analysis should reconcile planned and actual purchases");
assert(html.includes('Zusätzlich gekauft')&&html.includes('Nicht auf dem Beleg erkannt'),"plan reconciliation should surface extras and missing planned products");
assert(html.includes('planComparison:buildPlanVsReceipt'),"new receipts should persist plan comparison evidence");
assert(html.includes('Wie nah kaufst du an deiner Liste?')&&html.includes('Beleg-OCR kann einzelne Positionen übersehen'),"stats should learn plan adherence without overstating OCR evidence");
assert(html.includes('clearOpenPurchasePlan()'),"completed purchases should clear the consumed shopping plan snapshot");

assert(html.includes('id="statsImpulseProfile"')&&html.includes('Deine ungeplanten Käufe'),"stats should remember recurring unplanned purchases");
assert(html.includes('wiederholt ungeplant auf'),"impulse profile should identify repeated extras");
assert(html.includes('id="statsImpulseMonth"')&&html.includes('Geplant vs. zusätzlich'),"stats should compare monthly recognized extra spending");
assert(html.includes('Nur Belege mit vorher gespeichertem Einkaufsplan'),"monthly impulse insight must disclose its evidence scope");
assert(html.includes('id="statsImpulseRoutine"')&&html.includes('Vom Spontankauf zur Routine'),"stats should detect extras that later become planned purchases");
assert(html.includes('erstmals ungeplant')&&html.includes('in einem geplanten Einkauf wiedergefunden'),"impulse-to-routine explanation should be explicit");

assert(html.includes('personalPriceMemoryForWish')&&html.includes('dein typischer Preis'),"shopping list should surface personal price memory");
assert(html.includes('Gegen dein Preisgedächtnis'),"market comparison should explain unusual prices against personal history");
assert(html.includes('m.count<2||p.reference'),"personal unusual-price claims must require repeated purchases and non-reference prices");
assert(html.includes('Math.abs(delta)<.12'),"market detail should ignore small personal price deviations");
assert(html.includes('id="statsPriceVolatility"')&&html.includes('Wo deine Preise stark schwanken'),"stats should identify products with meaningful personal price volatility");
assert(html.includes('x.prices.length>=3')&&html.includes('x.spread>=.15'),"price volatility should require at least three purchases and meaningful spread");

assert(html.includes('id="savingFocus"')&&html.includes('Dein Sparfokus'),"shopping list should prioritize products where comparison matters personally");
assert(html.includes('Stabile Preise werden bewusst nicht hervorgehoben'),"savings focus should avoid warning spam for stable products");
assert(html.includes('spread>=.15')&&html.includes('signal.regular'),"savings focus should use personal volatility and repeat-purchase evidence");
assert(html.includes('id="personalBasketVerdict"')&&html.includes('Gegen dein Preisgedächtnis'),"market result should include a personal basket price verdict");
assert(html.includes('Richtwerte zählen nicht'),"personal basket verdict must exclude reference prices");
assert(html.includes('cheap.length')&&html.includes('expensive.length'),"personal basket verdict should distinguish cheaper, normal and expensive items");

assert(html.includes('id="receiptHeroInsight"')&&html.includes('DAS WICHTIGSTE')&&html.includes('strongestReceiptInsight'),"receipt should lead with one strongest personal aha insight");
assert(html.includes('score:98')&&html.includes('score:96')&&html.includes('score:94'),"hero insight should prioritize supported savings, personal price anomalies and plan extras");
assert(html.includes('Beleg-Gesamtsumme')&&html.includes('maßgebliche Ausgabe'),"hero fallback must preserve printed receipt total as source of truth");
assert(html.includes('Dieser Beleg hat Caddy beigebracht'),"saved receipt should explain the value learned from scanning");
assert(html.includes('history.length?"💡 "+history[0].title'),"home pulse should lead with the latest personal shopping discovery");

assert(html.includes('BEIM NÄCHSTEN EINKAUF')&&html.includes('receiptNextMove'),"receipt analysis should turn insight into a concrete next-shopping action");
assert(html.includes('außerhalb deiner Liste dazu')&&html.includes('gehören sie vielleicht künftig bewusst auf die Liste'),"next move should learn from unplanned extras without auto-adding them");
assert(html.includes('Behalte ')&&html.includes('besonders im Blick'),"next move should flag personally expensive repeat products");
assert(html.includes('id="shoppingMemory"')&&html.includes('Dein Preisgedächtnis'),"home should visualize real knowledge accumulated from receipts");
assert(html.includes('<span>wiederkehrend</span>')&&html.includes('<span>Preishistorien</span>')&&html.includes('eigene Vergleichshistorie'),"shopping memory should use evidence-based progress metrics");
assert(html.includes('Die Anzeige beschreibt nur, wie viel eigene Vergleichshistorie bereits vorhanden ist.'),"shopping memory should explain that its progress reflects accumulated comparison history");

assert(html.includes('id="impulseSuggestions"')&&html.includes('Du kaufst das sowieso öfter'),"planner should surface recurring unplanned purchases before shopping");
assert(html.includes('x.count>=2')&&html.includes('cutoff.setDate(cutoff.getDate()-90)'),"impulse suggestions should require repeated and recent evidence");
assert(html.includes('Nichts wird automatisch hinzugefügt'),"impulse learning must preserve explicit user control");
assert(html.includes('data-impulse-add')&&html.includes('+ Liste'),"recurring impulse suggestions should be explicitly addable to the real shopping list");
assert(html.includes('typisch ')&&html.includes(' · Tief '),"impulse suggestions should reuse personal price memory when available");
assert(html.includes('planComparison:x.planComparison||cached.planComparison||null'),"server sync must preserve plan comparison learning");
assert(html.includes('itemsComplete:x.itemsComplete!=null?!!x.itemsComplete:cached.itemsComplete')&&html.includes('unassignedAmount:x.unassignedAmount!=null?Number(x.unassignedAmount):cached.unassignedAmount'),"server sync must preserve local receipt completeness metadata while accepting richer server evidence");

assert(html.includes('Beleg scannen')&&html.includes('Beleg-Analyse')&&html.includes('Meine Belege & Privatsphäre'),"visible receipt product language should consistently use Beleg");
assert(!html.includes('Bon scannen')&&!html.includes('Bon-Analyse')&&!html.includes('Meine Bons & Privatsphäre'),"legacy Bon terminology must not return in primary UI");

assert(html.includes('premium mobile design system')&&html.includes('clamp(32px,9vw,46px)'),"premium design should use fluid mobile typography");
assert(html.includes('env(safe-area-inset-top)')&&html.includes('env(safe-area-inset-bottom)'),"mobile shell should respect phone safe areas");
assert(html.includes('@media(max-width:359px)')&&html.includes('@media(min-width:600px)'),"design system should cover narrow and large phone widths");
assert(html.includes('min-height:46px')&&html.includes('min-height:52px'),"primary controls should retain comfortable mobile touch targets");
assert(html.includes('prefers-reduced-motion:reduce'),"premium motion should respect accessibility preferences");
assert(html.includes('hierarchy + interaction refinement')&&html.includes('#receiptHeroInsight strong'),"receipt result should visually prioritize the strongest insight");

assert(html.includes('memory-ring')&&html.includes('conic-gradient'),"personal price memory should use a responsive visual progress graphic");
assert(html.includes('Die Anzeige beschreibt nur, wie viel eigene Vergleichshistorie bereits vorhanden ist'),"price memory graphic must not imply a quality score");
assert(html.includes('memory-metrics')&&html.includes('Preishistorien'),"price memory should surface evidence-based metrics visually");
assert(html.includes('stat-bar-track')&&html.includes('stat-bar-fill'),"monthly category changes should use responsive data bars");

assert(html.includes('class="ep-icon"')&&html.includes('<svg viewBox="0 0 24 24">'),"home actions should use the native premium line icon system");
assert(html.includes('Einkauf in Sekunden verstehen')&&html.includes('Preise vergleichen &amp; sparen')&&html.includes('Einkaufsverhalten verstehen'),"home action copy should be concise and benefit-led");
assert(html.includes('grid-template-columns:48px minmax(0,1fr) 18px'),"home actions should use compact single-row mobile hierarchy");
assert(!html.includes('<span>🧾</span>Beleg scannen')&&!html.includes('<span>🛒</span>Einkaufsliste')&&!html.includes('<span>📊</span>Meine Statistik'),"legacy emoji home navigation must not return");

assert(html.includes('home action collision fix')&&html.includes('.homeaction .homeaction-copy{width:auto!important;height:auto!important'),"nested home action copy must override legacy span sizing");
assert(html.includes('.homeaction>.ep-icon'),"icon sizing must target only the direct icon child");

assert(html.includes('v7.201 planner viewport + compact quantity pass'),"planner should include the compact viewport regression guard");
assert(html.includes('#planner #list{max-width:100%!important;overflow:hidden!important}'),"shopping list must not overflow the phone viewport");
assert(html.includes('grid-template-columns:22px minmax(0,1fr) auto 16px'),"planner rows should reserve flexible product space instead of oversized fixed controls");
assert(html.includes('@media(max-width:430px)')&&html.includes('#planner .planner-main{padding:12px!important}'),"planner should become denser on phone widths");
assert(/<span class="version">v\d+\.\d+\.\d+ RC<\/span>/.test(html),"visible app release-candidate version badge missing");

assert(html.includes('v7.202 supermarket interaction + quantity clarity'),"planner should include supermarket interaction polish");
assert(html.includes('aria-label="Eine Packung '+"'"+'+name+'+"'"+' weniger"')&&html.includes('aria-label="Eine Packung '+"'"+'+name+'+"'"+' mehr"'),"quantity controls should expose product-specific accessible labels");
assert(html.includes('basketItemSignature(w)')&&html.includes('mergeBasketQuantity(duplicate,w)')&&html.includes('target.packCount=currentCount+incomingCount'),"duplicate shopping items should merge into pack quantity instead of creating duplicate rows");
assert(html.includes('Object.entries(w.choice).filter(([k])=>k!=="Größe")'),"basket identity should preserve meaningful product variants instead of merging them");
assert(html.includes('map(([k,v])=>k+"="+v).join("&")'),"basket variant identity should be deterministic across choice field order");
assert(html.includes('#planner .qty-buttons button{touch-action:manipulation!important}'),"quantity buttons should be optimized for touch shopping");

assert(html.includes('v7.203 long-list stability + undo safety'),"planner should include long-list rendering and undo safety");
assert(html.includes('function clearUndoState()')&&html.includes('Math.min(Math.max(0,restoreIndex),basket.length)'),"undo should restore safely even after list positions change");
assert(html.includes('if(!Number.isInteger(i)||i<0||i>=basket.length)return'),"delete handler should reject stale or invalid list indices");
assert(html.includes('content-visibility:auto')&&html.includes('contain-intrinsic-size:50px'),"long shopping lists should avoid unnecessary offscreen rendering work");
assert(html.includes('@media(prefers-reduced-motion:reduce)')&&html.includes('.list-undo-toast{transition:none!important}'),"planner motion should respect reduced-motion preferences");

assert(html.includes('v7.204 quantity-aware add/merge'),"planner should include quantity-aware duplicate merging");
assert(html.includes('energy:receiptEnergySnapshot(receiptDraft)'),"live receipt preview must use the in-scope receipt draft for energy analysis");
assert(html.includes('await finalizeScannedReceipt()'),"fully verified receipt scans must auto-save without a second confirmation click");
assert(html.includes('$("analysisSaving").textContent="–"'),"receipt reanalysis must clear stale savings before evaluating the new scan");
assert(html.includes('receiptCash.changeCorrected=true')&&html.includes('aus Barzahlung und Belegsumme geprüft'),"implausible OCR change must be corrected from cash minus authoritative total");
assert(html.includes('function mergeBasketQuantity(target,incoming)')&&html.includes('currentCount+incomingCount'),"duplicate items should add the incoming pack count, not merely increment by one");
assert(html.includes('const incomingCount=Math.max(1,Number(incoming.packCount)||1)'),"explicit quantities should survive duplicate merging");
assert(html.includes('normalizeSpokenQuantity')&&html.includes('spokenNumberWords'),"shopping input should normalize spoken German quantity words");
assert(html.includes('elf:11'),"spoken German quantity normalization should include eleven");
assert(html.includes('Voice input: remove conversational filler without losing the quantity/product phrase.'),"spoken quantity filler-word regression marker missing");
assert(html.includes('replace(/^\\s*(?:(?:bitte|noch|dazu|und|gern|gerne)\\s+)+/i,"")'),"spoken quantity normalization should strip repeated shopping filler words");
assert(html.includes('q=q.replace(/^\\d+\\s*(?:x|packungen?|packs?)'),"shopping suggestions should strip multipack prefixes before matching products");
assert(html.includes('kg|g|gramm|l|liter|ml|stück|stuck|stueck|stk|x'),"shopping parser should accept explicit unit and x-style quantity input");
assert(html.includes('protectedDecimal=source.replace(/(\\d),(\\d)/g,"$1§DEC§$2")'),"pasted shopping lists must preserve German decimal commas");
assert(html.includes('function splitShoppingSpeech(text)')&&html.includes('replace(/(\\d),(\\d)/g,"$1§DEC§$2")'),"voice shopping input must preserve German decimal-comma quantities");
assert(html.includes('function splitShoppingSpeech(text)')&&html.includes('trim().replace(/(\\d),(\\d)/g,"$1§DEC§$2").replace(/[.;]+/g,",")'),"voice decimal protection must run before punctuation normalization");
assert(html.includes('replace(/§DEC§/g,",")'),"pasted list decimal protection must restore the original German quantity");

assert(html.includes('let multi=rawForAmount.match(/^(\\d+)\\s*(?:x|×|packungen?|packs?)'),"shopping parser should recognize multipack quantity syntax");
assert(html.includes('multiPack={count,amount:size*factor,unit,label'),"multipack parser should retain count and per-pack size separately");
assert(html.includes('wish.packCount=multiPack.count')&&html.includes('wish.amount=multiPack.count*multiPack.amount'),"multipacks should calculate total comparison quantity from pack count and pack size");
assert(html.includes('packungen?|packs?'),"shopping parser should accept natural pack/Packungen wording");
assert(html.includes('return multiPack?wish:initializePackageQuantity(wish)'),"explicit multipacks should not be overwritten by standard package inference");
assert(html.includes('natural German multipack phrasing'),"natural German multipack parser regression marker missing");
assert(html.includes('(?:à|a|je|zu\\s+je)?'),"multipack parser should accept à/je wording before package size");
assert(html.includes('const natural=rawForAmount.match'),"multipack parser should accept product-before-size phrasing such as 2 Packungen Hackfleisch à 500 g");

assert(html.includes('function receiptItemUnits(item)')&&html.includes('item?.quantity??item?.qty??item?.count??item?.packCount'),"receipt-plan comparison should read explicit receipt quantities");
assert(html.includes('fulfilledUnits:Math.min(plannedCount,bought)')&&html.includes('shortUnits:Math.max(0,plannedCount-bought)'),"receipt-plan comparison should measure partial fulfillment");
assert(html.includes('extraUnits:Math.max(0,bought-plannedCount)'),"receipt-plan comparison should detect buying more packs than planned");
assert(html.includes('Math.round(fulfilledUnits/plannedUnits*100)'),"plan adherence percentage should be based on fulfilled units, not merely matching product rows");
assert(html.includes('Nur teilweise gekauft')&&html.includes('Mehr als geplant'),"plan-vs-receipt UI should explain under- and over-buying");
assert(html.includes('von "+x.plannedUnits+" Pack."'),"partial purchases should show bought versus planned pack counts");

assert(html.includes('const countStkTotal=line.match')&&html.includes('receipt-stueck'),"receipt parser should recognize German Stk/Stück quantity lines");
assert(html.includes('(\\d{1,3})\\s*(?:stk\\.?|stück|stueck|stuck|pcs?\\.?)'),"receipt piece-count OCR should accept three-digit counts and common Stück/pcs variants");
assert((html.match(/\(\\d\{1,3\}\)\\s\*\[#\*x×\]/g)||[]).length>=4,"receipt multipack OCR should accept three-digit counts across inline, pending and return formats");
assert(html.includes('unitLinePrice:count?Number((total/count).toFixed(2)):null'),"Stück receipt lines should derive a useful per-item price");
assert(html.includes('(?:[x×*]|stk\\.?|stück|stueck|stuck|pcs?\\.?)'),"receipt quantity fallback should recognize x, multiplication signs and common Stück/pcs abbreviations");
assert(html.includes('const countOnly=line.match')&&html.includes('quantityOnly:true'),"receipt parser should retain standalone Stück counts for adjacent receipt lines");
assert(html.includes('unitPriceAfterCount=line.match')&&html.includes('(?:\\/|je|pro)\\s*(?:stk\\.?|stück|stueck|stuck|pcs?\\.?)'),"receipt parser should accept a per-piece price on the line after a quantity-only row");

assert(html.includes('betrag erhalten|zahlbetrag bar')&&html.includes('herausgegeben|rückgabe|rueckgabe'),"receipt cash extraction should accept common German paid/change labels");
assert(html.includes('bar(?:\\s+(?:gegeben|bezahlt))?')&&html.includes('zahlbetrag bar|bezahlt'),"receipt cash extraction should recognize Bar bezahlt and Bezahlt labels");
assert(html.includes('bar(?:\\s+(?:gegeben|bezahlt))?|cash|gegeben|bezahlt|betrag erhalten|zahlbetrag bar'),"receipt payment method should classify the same expanded cash labels as cash extraction");
assert(html.includes('function receiptCashConsistency(total,cash)'),"receipt parser should independently validate cash/change arithmetic");
assert(html.includes('difference<=.02'),"cash/change validation should allow only cent-level OCR tolerance");
assert(html.includes('score+=cashCheck.ok?28:-18'),"OCR candidate scoring should reward consistent cash arithmetic and penalize contradictions");
assert(html.includes('if(receiptCash.change==null){receiptCash.change=expected'),"printed receipt change must not be overwritten by a calculated value");
assert(html.includes('passt nicht zur Belegsumme'),"receipt UI should visibly flag contradictory printed change");
assert(html.includes('stimmt zur Belegsumme'),"receipt UI should confirm when printed cash/change arithmetic agrees with the receipt total");

assert(html.includes('const comma=s.lastIndexOf(",")')&&html.includes('const decimal=comma>dot?",":"."'),"receipt money parser should distinguish German and international decimal formats");
assert(html.includes('replace(/[€£]/g,"")')&&html.includes('replace(/\\s+/g,"")'),"receipt money parser should tolerate currency signs and OCR whitespace");
assert(html.includes('zu zahlen|zahlbetrag|endbetrag'),"receipt total parser should recognize common German total labels");
assert(html.includes('bar(?: gegeben| bezahlt)?')&&html.includes('apple pay|google pay'),"payment labels should be rejected as product names");
assert(html.includes('kontaktlos|contactless|nfc')&&html.includes('zahlung\\s+(?:mit\\s+)?karte'),"receipt payment method parsing should recognize contactless and Zahlung mit Karte variants");

assert(html.includes('function receiptStoreSearchText(text)'),"receipt merchant detection should normalize OCR header text");
assert(html.includes('replace(/\\bk\\s*a\\s*u\\s*f\\s*l\\s*a\\s*n\\s*d\\b/g,"kaufland")'),"merchant OCR should recover spaced Kaufland logos");
assert(html.includes('replace(/\\be\\s*d\\s*e\\s*k\\s*a\\b/g,"edeka")'),"merchant OCR should recover spaced EDEKA logos");
assert(html.includes('replace(/\\bp\\s*e\\s*n\\s*n\\s*y\\b/g,"penny")'),"merchant OCR should recover spaced PENNY logos");
assert(html.includes('replace(/\\ba\\s+l\\s+d\\s+i\\b/g,"aldi")'),"merchant OCR should recover spaced ALDI logos");
assert(html.includes('replace(/\\br\\s*e\\s*w\\s*e\\b/g,"rewe")'),"merchant OCR should recover spaced REWE logos");
assert(html.includes('replace(/\\bl\\s*i\\s*d\\s*l\\b/g,"lidl")'),"merchant OCR should recover spaced Lidl logos");
assert(html.includes('replace(/\\bn\\s*e\\s*t\\s*t\\s*o\\b/g,"netto")'),"merchant OCR should recover spaced Netto logos");
assert(html.includes('replace(/\\br\\s*o\\s*s\\s*m\\s*a\\s*n\\s*n\\b/g,"rossmann")'),"merchant OCR should recover spaced Rossmann logos");
assert(html.includes('replace(/\\bn\\s*o\\s*r\\s*m\\s*a\\b/g,"norma")'),"merchant OCR should recover spaced NORMA logos");
assert(html.includes('replace(/\\bm\\s*a\\s*r\\s*k\\s*t\\s*k\\s*a\\s*u\\s*f\\b/g,"marktkauf")')&&html.includes('replace(/\\bg\\s*l\\s*o\\s*b\\s*u\\s*s\\b/g,"globus")')&&html.includes('replace(/\\bt\\s*e\\s*g\\s*u\\s*t\\b/g,"tegut")'),"merchant OCR should recover spaced Marktkauf, Globus and tegut logos");
assert(html.includes('kaufland\\.de|kaufland-card')&&html.includes('edeka\\.de')&&html.includes('penny\\.de'),"merchant detection should use strong chain-specific receipt markers");

assert(html.includes('function receiptTotalBoundary(line)')&&html.includes('zahlbetrag|endbetrag'),"receipt item parsing should stop at authoritative German total labels");
assert(html.includes('endsumme|rechnungsbetrag'),"receipt total extraction should recognize additional authoritative German total labels");
assert(html.includes('betrag fällig|betrag faellig'),"receipt total extraction should recognize Betrag fällig OCR variants");
assert(html.includes('label==="betrag fällig"||label==="betrag faellig"'),"Betrag fällig labels should be treated as primary authoritative receipt totals");
assert(html.includes('bezahlt|erhalten|betrag erhalten|rückgeld|rueckgeld|wechselgeld|zurück|zurueck|herausgegeben|karte|kartenzahlung|kontaktlos|cash'),"split total extraction should not consume a following payment or change line as the receipt total");
assert(html.includes('function receiptFooterNoise(line,store="")'),"receipt parser should explicitly filter footer/payment noise");
assert(html.includes('const receiptStoreHint=detectReceiptStore(text)'),"receipt parsing should use merchant context for chain-specific noise filtering");
assert(html.includes('Kaufland:/^(?:kaufland card|k-card|treuepunkte|punkte)/'),"Kaufland loyalty footer text should not become product rows");
assert(html.includes('EDEKA:/^(?:deutschlandcard|genusspunkte|edeka app)/'),"EDEKA loyalty footer text should not become product rows");
assert(html.includes('PENNY:/^(?:payback|penny app|oecobon|ecobon)/'),"PENNY loyalty footer text should not become product rows");
assert(html.includes('ALDI:/^(?:aldi app|aldi talk)/'),"ALDI footer text should not become product rows");

assert(html.includes('function receiptAdjustmentLine(line)'),"receipt parser should classify discounts and coupons separately from products");
assert(html.includes('rabatt|coupon|gutschein|aktion|ersparnis|nachlass|discount|sofortbonus|payback'),"receipt adjustment parser should cover common German discount labels");
assert(html.includes('isAdjustment:true')&&html.includes('pricingType:"discount"'),"discount receipt rows should be explicitly marked as adjustments");
assert(html.includes('adjustmentType:/coupon|gutschein|payback/'),"coupon-like adjustments should be distinguishable from ordinary discounts");
assert(html.includes('pfand(?:artikel)?|einwegpfand|mehrwegpfand'),"receipt parser should recognize common German deposit labels");
assert(html.includes('at=lines.findIndex(x=>receiptTotalBoundary(x))'),"deposit OCR merging should use the same authoritative total boundary as receipt parsing");
assert(html.includes('!i.isDeposit&&!i.isAdjustment'),"receipt product analytics should exclude deposits and adjustments");

assert(html.includes('adjustment.appliedTo=previous.name')&&html.includes('adjustment.linkedToPrevious=true'),"receipt discounts should link to the preceding purchased product when possible");
assert(html.includes('previous.regularTotal=Number(previous.regularTotal||previous.price)'),"linked discounts should preserve the product regular price");
assert(html.includes('previous.discount=Number(((Number(previous.discount)||0)+discount).toFixed(2))'),"multiple linked discounts should accumulate on the product");
assert(html.includes('previous.price=String(paid)'),"linked discounts should reduce the actual paid product price");
assert(html.includes('function personalRegularComparablePrice(item)'),"receipt history should retain access to regular comparable prices separately from paid prices");

assert(html.includes('function receiptRecognizedTotal(rows)'),"receipt arithmetic should use one canonical recognized-total calculation");
assert(html.includes('r?.isAdjustment&&r?.linkedToPrevious?0:'),"product-linked discounts must not be subtracted twice from recognized receipt totals");
assert(html.includes('recognized=receiptRecognizedTotal(rows)'),"OCR candidate scoring should use discount-safe receipt arithmetic");
assert(html.includes('recognized=receiptRecognizedTotal(receiptDraft)'),"receipt verification should use discount-safe receipt arithmetic");
assert(html.includes('aiRecognized=receiptRecognizedTotal(receiptDraft)'),"AI receipt completeness checks should use the same canonical arithmetic");
assert(html.includes('function receiptUnassignedAmount(total,rows)')&&html.includes('receiptUnassignedAmount(total,receiptLines)'),"saved receipt unassigned amount should use canonical receipt arithmetic");

assert(html.includes('function receiptRecognizedProductSpend(rows)'),"receipt math should distinguish real product spend from total receipt arithmetic");
assert(html.includes('!r?.isDeposit&&!r?.isAdjustment&&Number(r?.price)>0'),"recognized product spend should exclude deposits and adjustments");
assert(html.includes('function receiptUnassignedAmount(total,rows)'),"unassigned receipt amount should have one canonical calculation");
assert(html.includes('Math.max(0,Number((Number(total||0)-receiptRecognizedTotal(rows)).toFixed(2)))'),"unassigned receipt amount should never become negative after OCR overreads");
assert(html.includes('unassignedAmount:receiptArithmeticVerified?0:receiptUnassignedAmount(total,receiptDraft)'),"receipt preview should use canonical unassigned arithmetic");
assert(html.includes('unassignedAmount=receiptArithmeticVerified?0:receiptUnassignedAmount(total,receiptLines)'),"saved receipts should use canonical unassigned arithmetic");

assert(html.includes('function receiptDiscountStory(items,total)'),"receipt insights should derive a structured discount story");
assert(html.includes('regularProducts=Number((paidProducts+linkedDiscount).toFixed(2))'),"discount story should estimate the pre-discount basis from recognized products and linked discounts");
assert(html.includes('Math.round(linkedDiscount/regularProducts*100)'),"receipt discount insight should calculate a product-linked discount rate without mixing basket coupons into product pricing");
assert(html.includes('Größter zugeordneter Rabatt:'),"receipt insight should surface the strongest product-linked discount when available");
assert(html.includes('i?.discountSource==="linked-adjustment"?0:d'),"receipt discount totals should not double-count linked adjustment rows and product discount metadata");

assert(html.includes('paidProducts=receiptRecognizedProductSpend(items)'),"receipt discount insights should base product savings on recognized product spend");
assert(html.includes('linkedDiscount=linked.reduce'),"receipt discount insights should separate product-linked discounts");
assert(html.includes('unlinkedDiscount=Math.max(0'),"receipt discount insights should separate general coupons from product-linked savings");
assert(html.includes('regularProducts=Number((paidProducts+linkedDiscount).toFixed(2))'),"product discount rate should reconstruct regular product spend without deposit contamination");
assert(html.includes('direkt Produkten zugeordnet')&&html.includes('als allgemeiner Rabatt/Coupon erkannt'),"discount insight copy should distinguish linked and general receipt savings");

assert(html.includes('function aggregateReceiptPlanItems(items)'),"plan-vs-receipt comparison should aggregate duplicate product rows first");
assert(html.includes('g.actualUnits+=units'),"duplicate receipt rows should contribute all purchased units");
assert(html.includes('g.price=Number((g.price+price).toFixed(2))'),"duplicate receipt rows should combine spend for extra-purchase analysis");
assert(html.includes('g.sourceRows.push(index)')&&html.includes('g.sourceCount++'),"aggregated receipt products should retain source-row traceability");
assert(html.includes('let actual=aggregateReceiptPlanItems(current.items)'),"plan comparison should consume aggregated receipt products");
assert(html.includes('actualReceiptRows:current.items.filter'),"plan comparison should preserve raw receipt-row count separately from aggregated products");

assert(html.includes('function aggregatePlannedItems(items)'),"plan comparison should aggregate duplicate planned products before matching");
assert(html.includes('g.plannedUnits+=units'),"duplicate planned rows should combine their requested quantities");
assert(html.includes('g.sourcePlanRows.push(index)')&&html.includes('g.sourcePlanCount++'),"aggregated planned products should retain source-row traceability");
assert(html.includes('let planned=aggregatePlannedItems(plan.items)'),"plan-vs-receipt matching should consume aggregated planned products");
assert(html.includes('plannedSourceRows:plan.items.length'),"plan comparison should preserve original planned-row count separately from unique products");

assert(html.includes('function receiptPlanFallbackName(raw)'),"receipt-plan matching should normalize fallback product names consistently");
assert(html.includes('kg|g|ml|cl|l|stk|stueck|stuck|pack'),"fallback receipt-plan identity should ignore common quantity and package tokens");
assert(html.includes('if(m&&m.key)return "key:"+m.key'),"known catalog products should still prefer stable product keys over fuzzy fallback names");
assert(html.includes('const fallback=receiptPlanFallbackName(raw);return fallback?"raw:"+fallback:""'),"unknown products should use normalized fallback identities without creating empty match keys");

assert(html.includes('replace(/^\\s*\\d{1,3}\\s*[x×*]\\s*/,"")'),"fallback product identity should remove explicit leading multipack quantities");
assert(html.includes('(?:stk\\.?|stueck|stuck|pack(?:ung)?(?:en)?|pcs?)\\s+'),"fallback product identity should remove explicit leading piece/package counts");

assert(html.includes('item?.quantity??item?.qty??item?.count??item?.packCount'),"receipt unit extraction should use one explicit quantity source without multiplying duplicate representations");
assert(html.includes('function receiptItemUnits(item)')&&html.includes('stuck|pcs?\\.?'),"receipt unit extraction should accept common pcs OCR quantity variants");
assert(html.includes('gegeben|bezahlt|erhalten|betrag erhalten|zahlbetrag bar|ruckgeld|wechselgeld|zuruck|herausgegeben|ruckgabe')&&html.includes('kartenzahlung|kontaktlos|contactless|nfc')&&html.includes('endbetrag|endsumme|rechnungsbetrag|betrag fallig|betrag faellig'),"receipt footer filtering should exclude expanded payment and authoritative total labels from product rows");
assert(html.includes('function receiptPackPieces(item)'),"receipt quantity model should distinguish pieces contained in a pack");
assert(html.includes('stueck|stuck|pcs?\\.?'),"receipt pack-size inference should accept common OCR piece variants");
assert(html.includes('item?.packUnit==="piece"'),"piece multipacks should only affect physical piece count when pack metadata explicitly says piece");
assert(html.includes('function receiptPhysicalPieces(item){return receiptItemUnits(item)*receiptPackPieces(item)}'),"physical piece count should be derived separately from purchased-unit count");

assert(html.includes('const target=catalog[key]?.unit||"piece",count=receiptItemUnits(row)'),"receipt price and energy quantity conversion should reuse canonical purchased-unit semantics");
assert(!html.includes('const target=catalog[key]?.unit||"piece",count=Number(row.count)||1,pack='),"receipt comparison should not maintain a separate count-only quantity interpretation");

assert(html.includes('coveredSpend=Number(rows.reduce((n,x)=>n+x.spend,0).toFixed(2))'),"receipt calorie estimates should track spend covered by nutrition-capable rows");
assert(html.includes('sourceSpend=receiptRecognizedProductSpend(source)'),"calorie coverage denominator should use recognized product spend only");
assert(html.includes('coverage=sourceSpend>0?Math.max(0,Math.min(100'),"receipt calorie coverage should be bounded to a readable percentage");
assert(html.includes('assumedRows=rows.filter(x=>x.estimated).length'),"receipt calorie estimates should track rows that depend on quantity assumptions");
assert(html.includes('Die kcal-Auswertung deckt ')&&html.includes('der erkannten Produkt-Ausgaben ab'),"receipt calorie UI should disclose monetary coverage of the estimate");
assert(html.includes('Mengenannahme')&&html.includes('belastbare Menge'),"receipt calorie UI should disclose quantity assumptions and missing reliable quantities");

assert(html.includes('function receiptEnergySnapshot(items)'),"saved receipts should support compact persisted calorie summaries");
assert(html.includes('kcal:e.total')&&html.includes('coverage:e.coverage')&&html.includes('assumedRows:e.assumedRows'),"persisted calorie summaries should retain value, coverage, and assumption quality");
assert(html.includes('existing.energy=receiptEnergySnapshot(receiptLines)'),"updated receipts should refresh their persisted calorie summary");
assert(html.includes('energy:receiptEnergySnapshot(receiptLines),itemsComplete:')||html.includes('energy:receiptEnergySnapshot(receiptDraft),itemsComplete:'),"receipt energy snapshots should persist from the in-scope receipt items");
assert(html.includes('function aggregateReceiptEnergy(receipts)'),"receipt calorie snapshots should support cross-receipt aggregation");
assert(html.includes('coverage:sourceSpend>0?Math.max(0,Math.min(100'),"aggregate calorie coverage should remain bounded and spend-weighted");

assert(html.includes('id="statsEnergyMonth"')&&html.includes('id="statsEnergyMonthTitle"')&&html.includes('id="statsEnergyMonthDetail"'),"stats should include a dedicated monthly receipt-energy insight surface");
assert(html.includes('function renderStatsEnergyMonth(receipts)'),"stats should render monthly calorie history from persisted receipt energy snapshots");
assert(html.includes('if(summary.receipts<2||summary.coverage<50||quality<50)'),"monthly calorie insight should require multiple receipts and meaningful coverage before display");
assert(html.includes('keine Aussage darüber, wie viel davon tatsächlich gegessen wurde'),"monthly calorie insight should distinguish purchased energy from consumed calories");
assert(html.includes('renderStatsMonthStory(receipts);renderStatsEnergyMonth(receipts);'),"stats refresh should include monthly calorie insight rendering");

assert(html.includes('function migrateReceiptEnergySnapshots(receipts)'),"existing saved receipts should support one-time local calorie snapshot backfill");
assert(html.includes('if(r?.energy||!Array.isArray(r?.items)||!r.items.length)continue'),"calorie backfill should skip already-migrated receipts and receipts without source items");
assert(html.includes('const energy=receiptEnergySnapshot(r.items);if(energy){r.energy=energy;changed=true}'),"calorie backfill should only persist a snapshot when the existing receipt can actually be evaluated");
assert(html.includes('persistMigrated=value=>{if(!migrateReceiptEnergySnapshots(value))return;'),"receipt loading should avoid rewriting local storage when no calorie migration occurred");
assert(html.includes('persistMigrated(backup);return backup'),"backup receipt recovery should receive the same calorie snapshot migration");

assert(html.includes('function receiptAdjustmentLinkable(adjustment)'),"receipt parser should classify whether a discount is safe to attach to a product");
assert(html.includes('gutschein|coupon|payback|warenkorb|einkauf|gesamt|bon|treue|punkte|app'),"basket-level coupons and loyalty adjustments must not mutate a product price");
assert(html.includes('const previous=rows?.[rows.length-1]'),"product discounts should only attach to the immediately preceding parsed row");
assert(html.includes('previous.isDeposit||previous.isAdjustment'),"product discount linking must not jump across deposit or adjustment rows");
assert(html.includes('discount>Number(previous.price)+.01'),"linked product discounts should never exceed the immediately preceding product price");
assert(html.includes('previous.discountSource="linked-adjustment"'),"products changed by a linked receipt adjustment should retain explicit provenance");
assert(html.includes('linkReceiptAdjustment(rows,adjustment);rows.push(adjustment)'),"receipt parsing should route discount linking through the guarded helper");
assert(!html.includes('[...rows].reverse().find(r=>!r.isDeposit&&!r.isAdjustment&&Number(r.price)>0)'),"receipt discount parsing must not search backwards for an arbitrary earlier product");

assert(html.includes('function receiptItemForStorage(x)'),"receipt history should use one canonical item serializer");
assert(html.includes('linkedToPrevious:!!x?.linkedToPrevious')&&html.includes('discountSource:x?.discountSource||""'),"receipt storage should preserve linked-discount provenance across reloads");
assert(html.includes('adjustmentType:x?.adjustmentType||""')&&html.includes('pricingType:x?.pricingType||""'),"receipt storage should preserve adjustment classification");
assert(html.includes('quantitySource:x?.quantitySource||""'),"receipt storage should preserve parsed quantity provenance");
assert((html.match(/receiptItemsForStorage\(receiptLines\)/g)||[]).length>=2,"new and updated receipts should share canonical item serialization");
assert(html.includes('i?.discountSource==="linked-adjustment"?0:d'),"discount totals should not count a product discount twice when its adjustment row already represents it");
assert(!html.includes('const linked=new Set((items||[]).filter(i=>i?.isAdjustment&&i?.linkedToPrevious'),"discount deduplication should no longer depend on fragile product-name and amount set matching");

assert(html.includes('family=/^ALDI\\b/i.test(String(store||""))?"ALDI":store'),"ALDI Nord and Süd receipts should share ALDI-specific footer filtering");
assert(html.includes('const drugstoreFreshBlocked=new Set(['),"drugstore comparisons should maintain an explicit fresh-food denylist");
assert(html.includes('"rinderhack","hackfleisch","haehnchenbrust"'),"fresh meat must be hard-blocked from dm and Rossmann comparisons");
assert(html.includes('"eier","milch","joghurt","quark","skyr","butter","kaese"'),"fresh and chilled staples should be hard-blocked from drugstore comparisons");
assert(html.includes('if(drugstoreFreshBlocked.has(product))return false;return storeAssortment.drugstore.has(product)'),"dm and Rossmann eligibility should require both not-fresh and explicit assortment approval");
assert(html.includes('"zahnpasta","shampoo"')&&html.includes('"waschmittel","spuelmittel"'),"core drugstore products should remain eligible for dm and Rossmann");

assert(html.includes('serverItems=Array.isArray(x.items)&&x.items.length?x.items:null')&&html.includes('receiptItemsForStorage(serverItems)'),"server receipt sync should normalize incoming item metadata");
assert(html.includes('energy=x.energy||cached.energy||receiptEnergySnapshot(items)'),"server receipt sync should preserve or reconstruct calorie snapshots");
assert(html.includes('savingMeta:x.savingMeta||cached.savingMeta||null')&&html.includes('planComparison:x.planComparison||cached.planComparison||null'),"server receipt sync should preserve rich savings and plan evidence");
assert(html.includes('itemsComplete:x.itemsComplete!=null?!!x.itemsComplete:cached.itemsComplete')&&html.includes('unassignedAmount:x.unassignedAmount!=null?Number(x.unassignedAmount):cached.unassignedAmount'),"server receipt sync should preserve receipt completeness evidence");
assert(html.includes('fingerprint:x.fingerprint||cached.fingerprint||""'),"server receipt sync should retain receipt fingerprint provenance");

// v7.209 stale receipt refresh guard
assert(html.includes('function applyReceiptText(text,label){\n receiptPriceRefreshRevision++;\n receiptDraft=parseReceiptText(text);'),"starting a new receipt must invalidate any older asynchronous price refresh before replacing the draft");

// v7.210 OCR candidate quality guard
assert(html.includes("function receiptCandidateQuality(candidate)")&&html.includes("function betterReceiptCandidate(current,next)"),"OCR fallback passes must rank candidates by receipt quality, not raw OCR score alone");
assert(html.includes("best=betterReceiptCandidate(best,combined);")&&html.includes("best=betterReceiptCandidate(best,candidate);"),"full-length OCR fallback must use receipt-quality candidate selection");

// v7.211 adaptive OCR depth guard
assert(html.includes("function receiptNeedsDeepScan(candidate)")&&html.includes("coverage<.92"),"receipt OCR should only run expensive fallback passes when the first read is materially incomplete");
assert(html.includes("if(receiptNeedsDeepScan(best)){")&&html.includes("if(receiptNeedsDeepScan(best)&&best.total>0"),"long-receipt and deposit fallback scans must share the adaptive deep-scan gate");

// v7.212 band OCR quality guard
assert((html.match(/best=betterReceiptCandidate\(best,combined\);/g)||[]).length>=2,"both band and full-length OCR merges must use the same receipt-quality ranking");

// v7.213 mobile OCR memory guard
assert(html.includes("function receiptOcrCanvasSize(crop)")&&html.includes("maxPixels=5200000")&&html.includes("maxHeight=4200"),"long receipt OCR crops must cap canvas memory for mobile browsers");
assert(html.includes("receiptCrop(file,crop,lang,psm,contrast=1.75)"),"receipt crop preprocessing must keep contrast configurable for fallback reads");

// v7.214 adaptive contrast OCR guard
assert(html.includes('"Kontrastarmer Beleg wird nachgeschärft …"')&&html.includes('receiptCrop(scanFile,fullArea,"deu",6,2.35)'),"weak full-receipt reads must receive one targeted high-contrast OCR fallback");
assert(html.includes("best=betterReceiptCandidate(best,contrastCandidate);best=betterReceiptCandidate(best,combined)"),"high-contrast OCR must only win through receipt-quality ranking");

// v7.215 scan race guard
assert(html.includes("let receiptScanRevision=0;")&&html.includes("function receiptScanCurrent(revision)"),"receipt scanning must maintain a revision token so stale OCR cannot overwrite a newer scan");
assert(html.includes("async function runImageReceiptOCR(file,scanRevision=++receiptScanRevision)")&&html.includes("if(!receiptScanCurrent(scanRevision))return;"),"OCR stages must stop when their scan revision is stale");
assert(html.includes("const scanRevision=++receiptScanRevision;"),"every processReceiptFile invocation must invalidate older scan work immediately");

// v7.216 contextual OCR money normalization guard
assert(html.includes("function normalizeReceiptMoneyOCR(v)")&&html.includes('.replace(/[oO]/g,"0").replace(/[iIlL|]/g,"1")'),"receipt money parsing must repair common OCR digit confusions without rewriting product names");
assert(html.includes("out.paid=parseReceiptNumber(normalizeReceiptMoneyOCR(m[1]))")&&html.includes("out.change=parseReceiptNumber(normalizeReceiptMoneyOCR(m[1]))"),"cash tender and change must share contextual OCR money normalization");

// v7.217 German quantity row guards
assert(html.includes("const countUnitEquals=line.match")&&html.includes("const quantityPrefix=line.match"),"receipt parser must retain common split German quantity/price row formats");
assert(html.includes('quantitySource:"receipt-stueck"')&&html.includes('quantitySource:"receipt-multipack"'),"split quantity rows must preserve quantity provenance");

// v7.218 product/deposit relationship guard
assert(html.includes("function receiptProductDepositLinks(rows)")&&html.includes("depositRows.push(j)"),"receipt analysis must derive adjacent product-to-deposit relationships with source-row provenance");
assert(html.includes("combinedTotal:Number(((Number(product.price)||0)+deposit).toFixed(2))"),"product/deposit relationships must expose the combined paid amount without mutating product price");

// v7.219 three-line receipt quantity guard
assert(html.includes("const countUnitThenTotal=line.match")&&html.includes("awaitingPrintedTotal:true"),"receipt parser must retain product + count/unit + printed-total sequences");
assert(html.includes("const name=pendingMultiple.name||pendingName"),"pending multipack identity must win over transient following text when its printed total arrives");

// v7.220 legal comparison guard
assert(html.includes('"Keine belastbare Rangfolge"')&&html.includes('"Referenzwerte werden nicht als Händler-Ranking verwendet"'),"modeled/reference prices must never produce a named retailer winner");
assert(html.includes('complete.filter(r=>r.referenceCount>0).sort((a,b)=>a.store.localeCompare(b.store,"de"))'),"reference-only retailer orientations must use neutral alphabetical display rather than price ranking");
assert(html.includes("verifiedComplete=complete.filter(r=>r.referenceCount===0).sort((a,b)=>a.total-b.total)"),"price ranking must be restricted to fully evidenced baskets");

assert(html.includes("Vergleichsmethode & Datenqualität")&&html.includes("Entfernung oder Händlername beeinflussen die Preisrangfolge nicht")&&html.includes("Referenzwerte")&&html.includes("dürfen keinen Händler zum Gewinner oder Verlierer machen"),"ranking parameters and reference-price exclusions must be directly disclosed from comparison results");
