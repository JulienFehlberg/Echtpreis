const http = require('http');
const PORT = process.env.PORT || 10000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-6-astra';

const schema={type:'object',additionalProperties:false,properties:{
 document_type:{type:'string',enum:['Rechnung','Kostenvoranschlag','Angebot','Kassenbon','Preisschild','Preis-Dokument','Unklar']},
 provider:{type:['string','null']},date:{type:['string','null']},total:{type:['number','null']},currency:{type:'string'},
 travel_fee:{type:['number','null']},labor_amount:{type:['number','null']},labor_description:{type:['string','null']},material_amount:{type:['number','null']},vat_amount:{type:['number','null']},
 line_items:{type:'array',items:{type:'object',additionalProperties:false,properties:{description:{type:'string'},quantity:{type:['number','null']},unit_price:{type:['number','null']},amount:{type:['number','null']},confidence:{type:'number',minimum:0,maximum:1}},required:['description','quantity','unit_price','amount','confidence']}},
 confidence:{type:'number',minimum:0,maximum:1},ambiguous_fields:{type:'array',items:{type:'string'}},notes:{type:'array',items:{type:'string'}}
},required:['document_type','provider','date','total','currency','travel_fee','labor_amount','labor_description','material_amount','vat_amount','line_items','confidence','ambiguous_fields','notes']};

function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'https://julienfehlberg.github.io','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'https://julienfehlberg.github.io','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'});return res.end();}
 if(req.method==='GET'&&req.url==='/health')return send(res,200,{ok:true,service:'ECHTPREIS API',version:'0.9'});
 if(req.method!=='POST'||req.url!=='/analyze')return send(res,404,{error:'Not found'});
 if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'OPENAI_API_KEY fehlt auf dem Server.'});
 let raw='';req.on('data',c=>{raw+=c;if(raw.length>16_000_000)req.destroy();});
 req.on('end',async()=>{try{
   const body=JSON.parse(raw||'{}'); const image=body.image;
   if(typeof image!=='string'||!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image))return send(res,400,{error:'Ungültiges Bild.'});
   const prompt=`Du bist die Dokument-Erkennung von ECHTPREIS. Analysiere das Foto visuell, auch Handschrift. Lies nur Werte, die im Bild tatsächlich erkennbar sind. NIEMALS raten oder fehlende Zahlen erfinden. Unlesbare/unsichere Felder müssen null sein und in ambiguous_fields genannt werden. Unterscheide Rechnung, Kostenvoranschlag, Angebot, Kassenbon und Preisschild. Erfasse Anbieter, Datum, Gesamtbetrag, Anfahrt, Arbeit/Lohn, Material, MwSt und einzelne Leistungen/Artikel. Geldwerte als reine Zahlen in EUR. confidence 0..1. Persönliche Kundendaten wie Name, Anschrift, Telefon, IBAN nicht extrahieren.`;
   const api=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:image,detail:'high'}]}],text:{format:{type:'json_schema',name:'echtpreis_document',strict:true,schema}}})});
   const data=await api.json(); if(!api.ok)return send(res,502,{error:'KI-Analyse fehlgeschlagen.',detail:data?.error?.message||'OpenAI API Fehler'});
   const out=data.output_text || data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
   if(!out)return send(res,502,{error:'Keine strukturierte KI-Antwort erhalten.'});
   return send(res,200,{version:'0.9',analysis:JSON.parse(out)});
 }catch(e){return send(res,500,{error:'Analyse fehlgeschlagen.',detail:e.message});}});
});
server.listen(PORT,()=>console.log(`ECHTPREIS API 0.9 on ${PORT}`));
