const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");
const html=fs.readFileSync("index.html","utf8");
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());
assert(scripts.length>=3,"inline scripts missing");
scripts.forEach((code,i)=>{const file=path.join(os.tmpdir(),"echtpreis-inline-"+(i+1)+".js");fs.writeFileSync(file,code);const r=cp.spawnSync(process.execPath,["--check",file],{encoding:"utf8"});assert.strictEqual(r.status,0,"inline script "+(i+1)+" syntax: "+(r.stderr||r.stdout));});
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.strictEqual(new Set(ids).size,ids.length,"duplicate HTML ids");
["productInput","addBtn","compareBtn","demoListBtn","list","stores","results","receiptFile","receiptStore","receiptDate","finishPurchaseBtn","reviewRows","ocrStatus","receiptTotalCheck","receiptStoreDetail","receiptPaymentDetail","receiptInsight","receiptInsightTitle","statsAverage","statsBreakdown","statsTrend","statsDiscoveries","statsRecent","statsInsight","feedbackText","feedbackSend","feedbackStatus","homePulse","homePulseTitle","homePulseDetail"].forEach(id=>assert(ids.includes(id),"missing required element #"+id));
assert(!html.includes('addEventListener("click",compareStable)'),"legacy compare engine is still bound");
assert(!html.includes('var demo=byId("demoListBtn")'),"obsolete demo handler is still bound");
assert(html.includes("window.addEchtpreisItem"),"single-basket bridge missing");
assert(html.includes("window.replaceEchtpreisList"),"saved-list bridge missing");
assert(html.includes("rawForAmount"),"decimal-comma quantity parser missing");
assert(html.includes("receiptCandidateScore"),"multi-pass receipt scoring missing");
assert(!html.includes('label for="receiptTotalInput"'),"manual receipt-total editor must stay hidden");
assert.strictEqual((html.match(/function importRecipeIngredients\s*\(/g)||[]).length,1,"recipe import must have one implementation");
assert(html.includes("plausibleReceiptItemName"),"receipt item plausibility guard missing");
assert(html.includes("comparisonQuality"),"comparison confidence labelling missing");
assert(!html.includes("compareStable"),"obsolete duplicate comparison engine must stay removed");
assert(html.includes('history.sort((a,b)=>String(b.date).localeCompare(String(a.date))||Number(b.trust||0)-Number(a.trust||0)||a.price-b.price)'),"historical fallback must prioritize freshness and trust");
assert(html.includes("echtpreis_openprices_sync_by_key_v3"),"Open Prices should be cached per product and location scope");
assert(html.includes("const keys=[...new Set(basket.map(w=>w.key).filter(Boolean))]"),"manual compare should derive and deduplicate basket price categories");
assert(!html.includes("syncSharedData();ingestOpenPrices();"),"startup must not fetch the full Open Prices catalog");
assert(html.includes('<script src="app/config.js"></script>'),"store-ready config layer missing");
assert(html.includes('<script src="app/runtime.js"></script>'),"platform runtime layer missing");
assert(html.includes("window.EchtpreisRuntime"),"location flow must use the platform runtime");
assert(html.includes('href="privacy.html"'),"privacy entry point missing");
assert(html.includes('rel="manifest"'),"installable web-app manifest missing");
assert(html.includes('apple-mobile-web-app-capable'),"iOS home-screen metadata missing");
assert(html.indexOf('id="homeReceipt"')<html.indexOf('id="homePlan"'),"receipt scan should be the primary home action");
assert(html.includes("Beleg scannen"),"primary receipt action copy missing");
assert(html.includes("function buildReceiptInsight"),"personal receipt insight engine missing");
assert(html.includes("function renderStatsBreakdown"),"monthly spending breakdown missing");
assert(html.includes("sicher kategorisiert"),"spending breakdown confidence coverage missing");
assert(html.includes('x.category!=="Sonstiges"'),"uncertain categories must not drive post-scan category facts");
assert(html.includes("echtpreis_insight_history_v1"),"personal insight history missing");
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
assert(html.includes("echtpreis_feedback_queue_v1"),"offline feedback queue missing");
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
assert(html.includes("verifiedBest.total<=win.total*1.12"),"basket ranking must balance evidence quality with useful cold-start savings");
assert(html.includes('type:"first-receipt-fact"'),"first receipt should produce an immediate useful fact");
assert(html.includes("function receiptMarketComparison")&&html.includes('currentReceiptSavingConfidence="hoch"'),"receipt markets must be compared item by item and savings kept to evidenced prices");
assert(html.includes("async function finalizeScannedReceipt")&&html.includes("await finalizeScannedReceipt()"),"verified receipt scans must save without a second confirmation tap");
assert(html.includes("Beleg-Gesamtsumme")&&html.includes("analysisPartialRow"),"receipt total and honest partial savings must be visible in the analysis");
assert(!html.includes('id="contribute"')&&html.includes('id="pointsContribute"'),"sharing preference must stay out of the scan result and remain manageable in settings");
assert(html.includes(".slice(0,3)")&&html.includes("receipt-top-market"),"receipt results must show no more than the three cheapest lower estimates");
assert(html.includes("combineReceiptCandidates")&&html.includes(".96,.48")&&html.includes(".96,.30"),"receipt OCR must inspect overlapping bands through the bottom of the receipt");
assert(html.includes("const pending=Promise.allSettled")&&html.includes("comparisonRefreshPromise=pending")&&html.includes("comparisonRefreshPromise===pending"),"shopping comparison should render cache-first without an older refresh clearing a newer one");
assert(html.includes("Promise.allSettled([loadNearbyStores(),ingestOpenPrices(false,keys)])"),"location and live price refresh should run in parallel");
assert(html.includes("comparisonRefreshPromise"),"concurrent background comparison refreshes should be deduplicated");
assert(html.includes("echtpreis_nearby_store_cache_v1"),"nearby stores should persist across sessions for fast repeat comparisons");



const cat=(html.match(/openPricesCategory:/g)||[]).length;assert(cat>=15,"too few live Open Prices categories: "+cat);
const products=(html.match(/label:"/g)||[]).length;assert(products>=30,"primary product catalog unexpectedly small: "+products);
assert(!html.includes("stableBasket"),"obsolete duplicate basket state must stay removed");
assert(html.includes("if(dataEngineCache&&dataEngineCacheDay===today)return dataEngineCache"),"normalized observation engine should be cached only for the current day");
assert(html.includes("priceLookupMemo"),"basket price lookups should be memoized within a comparison");
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
assert(html.includes('die kcal-Zahl beschreibt deshalb ausdrücklich nur den erkannten Teil des Einkaufs'),"calorie insight must disclose partial receipt coverage");
assert(html.includes('itemsComplete:!!receiptArithmeticVerified')&&html.includes('id:"preview"'),"receipt preview must carry completeness metadata");

assert(html.includes('type:"receipt-coverage"')&&html.includes('noch nicht einzelnen Artikeln zugeordnet'),"partial receipts should generate a transparent coverage insight");
assert(html.includes('type:"cost-concentration"'),"receipt insights should detect concentrated spending");
assert(html.includes('im Schnitt "+eur(avg)+" pro Einkauf'),"monthly receipt insight should include average basket value");

assert(html.includes('type:"favorite-store"')&&html.includes('type:"favorite-product"'),"stats profile should learn recurring stores and products");
assert(html.includes('type:"personal-price-move"')&&html.includes('keine allgemeine Marktpreisaussage'),"personal price movement insight must stay scoped to user receipts");
assert(html.includes('type:"shopping-day"')&&html.includes('type:"category-spend"'),"stats profile should learn shopping day and category patterns");
assert(html.includes('echtpreis_recent_stats_insights_v1'),"stats insights should rotate instead of showing the same fact every time");

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
assert(html.includes('deshalb zeigt ECHTPREIS noch keine Warenkorb-Ersparnis'),"weak partial comparisons must not claim basket savings");

assert(html.includes('id="statsSavingsEvidence"'),"stats should expose evidence-aware savings section");
assert(html.includes('currentReceiptSavingMeta={store:best.store'),"receipt savings must persist comparison evidence metadata");
assert(html.includes('Bonwert vergleichbar')||html.includes('des Bonwerts vergleichbar'),"receipt comparison should visibly disclose basket coverage");
assert(html.includes('currentReceiptSavingConfidence')&&html.includes('savingConfidence:'),"qualified comparisons should persist confidence metadata");
assert(html.includes('Das ist keine garantierte Ersparnis'),"savings statistics must not present historical comparison totals as guaranteed savings");

assert(html.includes('id="receiptSavingDrivers"')&&html.includes('Was den Preisunterschied ausmacht'),"receipt analysis should explain savings at item level");
assert(html.includes('drivers:drivers.slice(0,8)'),"receipt savings evidence should persist item-level drivers");
assert(html.includes('id="statsSavingDrivers"')&&html.includes('Welche Produkte treiben deine Preisunterschiede?'),"stats should aggregate recurring savings drivers");
assert(html.includes('historische Vergleichsunterschiede, keine garantierte künftige Ersparnis'),"driver statistics must disclose historical scope");

assert(html.includes('id="receiptDiagnosis"')&&html.includes('Einkaufsdiagnose'),"receipt should show a unified shopping diagnosis");
assert(html.includes('function renderReceiptDiagnosis(current)'),"shopping diagnosis renderer must exist");
assert(html.includes('Kostentreiber')&&html.includes('Bonwert-Abdeckung'),"shopping diagnosis must explain cost driver and comparison coverage");
assert(html.includes('id="statsMonthlyAnomaly"')&&html.includes('Monats-Ausreißer'),"stats should detect meaningful monthly spending anomalies");
assert(html.includes('delta>=10')&&html.includes('pct>=25'),"category anomaly should require meaningful absolute and relative movement");

assert(html.includes('id="receiptBasketStory"')&&html.includes('Dein Warenkorb'),"receipt should classify the current basket");
assert(html.includes('bekannte Produkte')&&html.includes('neu in deinem Preisgedächtnis'),"receipt story should distinguish repeat and new products");
assert(html.includes('id="statsMonthStory"')&&html.includes('Dein Monat in einem Satz'),"stats should summarize the month in plain language");
assert(html.includes('id="statsRepeatProfile"')&&html.includes('Routine oder Entdecken?'),"stats should expose repeat versus discovery behavior");
assert(html.includes('id="statsLikelyNeeds"')&&html.includes('Könnte bald wieder nötig sein'),"stats should cautiously predict recurring purchase needs");
assert(html.includes('cv>.55||ratio<.8'),"need prediction must reject irregular or premature purchase patterns");
assert(html.includes('kein automatischer Eintrag auf die Einkaufsliste'),"need predictions must remain suggestions rather than silent list mutations");

assert(html.includes('data-need-add')&&html.includes('+ Liste'),"recurring need predictions should be explicitly addable to the shopping list");
assert(html.includes('dein Tiefpreis')&&html.includes('zuletzt '+"'"+'+eur(x.last.price)'),"need suggestions should include personal price memory");
assert(html.includes('Du entscheidest selbst, was auf die Liste kommt.'),"smart list suggestions must remain user controlled");

assert(html.includes('echtpreis_open_purchase_plan_v1')&&html.includes('saveOpenPurchasePlan'),"price comparison should preserve the planned basket for later receipt reconciliation");
assert(html.includes('Plan vs. Wirklichkeit')&&html.includes('buildPlanVsReceipt'),"receipt analysis should reconcile planned and actual purchases");
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

assert(html.includes('Das Wichtigste an diesem Einkauf')&&html.includes('strongestReceiptInsight'),"receipt should lead with one strongest personal aha insight");
assert(html.includes('score:98')&&html.includes('score:96')&&html.includes('score:94'),"hero insight should prioritize supported savings, personal price anomalies and plan extras");
assert(html.includes('Beleg-Gesamtsumme')&&html.includes('maßgebliche Ausgabe'),"hero fallback must preserve printed receipt total as source of truth");
assert(html.includes('Dieser Beleg hat ECHTPREIS beigebracht'),"saved receipt should explain the value learned from scanning");
assert(html.includes('history.length?"💡 "+history[0].title'),"home pulse should lead with the latest personal shopping discovery");

assert(html.includes('Beim nächsten Einkauf')&&html.includes('receiptNextMove'),"receipt analysis should turn insight into a concrete next-shopping action");
assert(html.includes('außerhalb deiner Liste dazu')&&html.includes('gehören sie vielleicht künftig bewusst auf die Liste'),"next move should learn from unplanned extras without auto-adding them");
assert(html.includes('Behalte ')&&html.includes('besonders im Blick'),"next move should flag personally expensive repeat products");
assert(html.includes('id="shoppingMemory"')&&html.includes('Dein Preisgedächtnis'),"home should visualize real knowledge accumulated from receipts");
assert(html.includes('wiederkehrende Produkte')&&html.includes('mit eigener Preishistorie'),"shopping memory should use evidence-based progress metrics");
assert(html.includes('Keine Punkte – nur Wissen aus deinen eigenen Einkäufen'),"shopping memory should not invent a gamified quality score");

assert(html.includes('id="impulseSuggestions"')&&html.includes('Du kaufst das sowieso öfter'),"planner should surface recurring unplanned purchases before shopping");
assert(html.includes('x.count>=2')&&html.includes('cutoff.setDate(cutoff.getDate()-90)'),"impulse suggestions should require repeated and recent evidence");
assert(html.includes('Nichts wird automatisch hinzugefügt'),"impulse learning must preserve explicit user control");
assert(html.includes('data-impulse-add')&&html.includes('+ Liste'),"recurring impulse suggestions should be explicitly addable to the real shopping list");
assert(html.includes('typisch ')&&html.includes(' · Tief '),"impulse suggestions should reuse personal price memory when available");
assert(html.includes('planComparison:cached.planComparison||null'),"server sync must preserve plan comparison learning");
assert(html.includes('itemsComplete:cached.itemsComplete')&&html.includes('unassignedAmount:cached.unassignedAmount'),"server sync must preserve local receipt completeness metadata");

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
assert(html.includes('<span class="version">v7.200.0 RC</span>'),"visible app version should be v7.200.0 RC");

assert(html.includes('v7.202 supermarket interaction + quantity clarity'),"planner should include supermarket interaction polish");
assert(html.includes('aria-label="Eine Packung '+name+' weniger"')&&html.includes('aria-label="Eine Packung '+name+' mehr"'),"quantity controls should expose product-specific accessible labels");
assert(html.includes('basketItemSignature(w)')&&html.includes('duplicate.packCount=Math.max(1,Number(duplicate.packCount)||1)+1'),"duplicate shopping items should merge into pack quantity instead of creating duplicate rows");
assert(html.includes('#planner .qty-buttons button{touch-action:manipulation!important}'),"quantity buttons should be optimized for touch shopping");

assert(html.includes('v7.203 long-list stability + undo safety'),"planner should include long-list rendering and undo safety");
assert(html.includes('function clearUndoState()')&&html.includes('Math.min(Math.max(0,restoreIndex),basket.length)'),"undo should restore safely even after list positions change");
assert(html.includes('if(!Number.isInteger(i)||i<0||i>=basket.length)return'),"delete handler should reject stale or invalid list indices");
assert(html.includes('content-visibility:auto')&&html.includes('contain-intrinsic-size:50px'),"long shopping lists should avoid unnecessary offscreen rendering work");
assert(html.includes('@media(prefers-reduced-motion:reduce)')&&html.includes('.list-undo-toast{transition:none!important}'),"planner motion should respect reduced-motion preferences");

assert(html.includes('v7.204 quantity-aware add/merge'),"planner should include quantity-aware duplicate merging");
assert(html.includes('function mergeBasketQuantity(target,incoming)')&&html.includes('currentCount+incomingCount'),"duplicate items should add the incoming pack count, not merely increment by one");
assert(html.includes('const incomingCount=Math.max(1,Number(incoming.packCount)||1)'),"explicit quantities should survive duplicate merging");
assert(html.includes('normalizeSpokenQuantity')&&html.includes('spokenNumberWords'),"shopping input should normalize spoken German quantity words");
assert(html.includes('kg|g|gramm|l|liter|ml|stück|stuck|stueck|stk|x'),"shopping parser should accept explicit unit and x-style quantity input");

assert(html.includes('let multi=rawForAmount.match(/^(\\d+)\\s*(?:x|×|packungen?|packs?)'),"shopping parser should recognize multipack quantity syntax");
assert(html.includes('multiPack={count,amount:size*factor,unit,label'),"multipack parser should retain count and per-pack size separately");
assert(html.includes('wish.packCount=multiPack.count')&&html.includes('wish.amount=multiPack.count*multiPack.amount'),"multipacks should calculate total comparison quantity from pack count and pack size");
assert(html.includes('packungen?|packs?'),"shopping parser should accept natural pack/Packungen wording");
assert(html.includes('return multiPack?wish:initializePackageQuantity(wish)'),"explicit multipacks should not be overwritten by standard package inference");

assert(html.includes('function receiptItemUnits(item)')&&html.includes('item?.quantity||item?.qty||item?.count||item?.packCount'),"receipt-plan comparison should read explicit receipt quantities");
assert(html.includes('fulfilledUnits:Math.min(plannedCount,bought)')&&html.includes('shortUnits:Math.max(0,plannedCount-bought)'),"receipt-plan comparison should measure partial fulfillment");
assert(html.includes('extraUnits:Math.max(0,bought-plannedCount)'),"receipt-plan comparison should detect buying more packs than planned");
assert(html.includes('Math.round(fulfilledUnits/plannedUnits*100)'),"plan adherence percentage should be based on fulfilled units, not merely matching product rows");
assert(html.includes('Nur teilweise gekauft')&&html.includes('Mehr als geplant'),"plan-vs-receipt UI should explain under- and over-buying");
assert(html.includes('von "+x.plannedUnits+" Pack."'),"partial purchases should show bought versus planned pack counts");

assert(html.includes('const countStkTotal=line.match')&&html.includes('receipt-stueck'),"receipt parser should recognize German Stk/Stück quantity lines");
assert(html.includes('unitLinePrice:count?Number((total/count).toFixed(2)):null'),"Stück receipt lines should derive a useful per-item price");
assert(html.includes('(?:[x×]|stk\\.?|stück|stueck)'),"receipt quantity fallback should recognize x, multiplication sign and German Stück abbreviations");
assert(html.includes('const countOnly=line.match')&&html.includes('quantityOnly:true'),"receipt parser should retain standalone Stück counts for adjacent receipt lines");
