"use strict";
const Gap=require("../../hit-native-list-gap"),Fixture=require("./hit-list-gap");
function batch(now=Fixture.NOW,{terminal=false}={}){
 const pending=terminal?[Fixture.node()]:[Fixture.node(),Fixture.node("4261911")];
 const previous=Fixture.cursor(pending,now),record=Gap.record(Fixture.page({now}),pending[0],{now}),isolated=Gap.isolate(previous,record,{now});
 const result={sourceId:Gap.SOURCE,cursorDay:previous.cursorDay,accepted:[],rejected:[],pages:[isolated.page],requests:3,complete:false,categoryTraversalCycleComplete:false,nativePaginationComplete:false,publishedTraversalComplete:false,physicalStoreAssortmentComplete:false,categoryCoverage:isolated.cursor.categoryCoverage,conflictGtins:[],cursor:isolated.cursor,total:previous.total,pagesFetched:isolated.cursor.pagesFetched,received:isolated.cursor.received,error:isolated.sourceError,originalListingGaps:[record]};
 return{previous,record,result};
}
async function mixed(now=Fixture.NOW){
 const good={...Fixture.node("4261800"),count:1},bad=Fixture.node(),pending=[good,bad,Fixture.node("4261911")],previous=Fixture.cursor(pending,now);
 const h=Fixture.harness({[good.url]:Fixture.page({category:good,rows:[Fixture.row(2)],now}).body,[bad.url]:Fixture.page({category:bad,now}).body},{now,maxRequests:4});
 const result=await require("../../hit-assortment-collector").collect({...h.options,cursor:previous,brandProbeEnabled:false});
 return{previous,result,record:result.originalListingGaps[0],calls:h.calls,time:h.options.now()};
}
module.exports={batch,mixed};
