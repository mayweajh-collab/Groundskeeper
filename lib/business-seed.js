import {normalizeOperations} from './lawn-workspace.js';

export function emptyBusinessWorkspace(seed,company,date){
 const data=structuredClone(seed);
 Object.assign(data,{company,datasetId:'groundskeeper-account-v1',date,clockDate:date,now:480,synthetic:false,geographic:false,area:'Your service area',jobs:[],clients:{},history:[],benchmarks:[],depot:{x:120,y:480,latitude:null,longitude:null,locationSource:'Add customers or set your crew base in Business settings.'},landscape:{version:1,projects:[],invoices:[],activity:[],sample:false}});
 delete data.roadMatrix;delete data.roadShapes;
 return normalizeOperations(data);
}
export function privateWorkspacePayload(data,state){
 return {data,state};
}
