const aliases={
 clientid:'client_id',customerid:'client_id',id:'client_id',
 clientname:'client_name',customername:'client_name',client:'client_name',customer:'client_name',name:'client_name',
 address:'address',clientaddress:'address',customeraddress:'address',serviceaddress:'address',propertyaddress:'address',fulladdress:'address',
 phone:'phone',clientphone:'phone',customerphone:'phone',phonenumber:'phone',telephone:'phone',
 email:'email',clientemail:'email',customeremail:'email',emailaddress:'email',
 mow:'mow',mowing:'mow',lawnmowing:'mow',mowlawn:'mow',
 edge:'edge',edging:'edge',lawnedging:'edge',
 mulching:'mulch',mulch:'mulch',hedge:'hedge',hedgemaintenance:'hedge',hedgetrimming:'hedge',
 city:'city',state:'state',zip:'zip',zipcode:'zip',postalcode:'zip',county:'county',latitude:'latitude',lat:'latitude',longitude:'longitude',lon:'longitude',lng:'longitude',
 price:'job_price_usd',jobprice:'job_price_usd',jobpriceusd:'job_price_usd',quotedprice:'job_price_usd',quoteamount:'job_price_usd',
 minutes:'estimated_minutes',estimatedminutes:'estimated_minutes',serviceminutes:'estimated_minutes',estimatedtime:'estimated_minutes',durationminutes:'estimated_minutes',
 crew:'crew_id',crewid:'crew_id',crewname:'crew_id'
};
export function lawnHeader(value){return aliases[String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'')]||null;}
export function normalizeLawnRows(rows){
 if(!rows.length)return [];
 const mapping=Object.keys(rows[0]).map(key=>[key,lawnHeader(key)]).filter(([,target])=>target);
 const targets=mapping.map(([,target])=>target);
 if(new Set(targets).size!==targets.length)throw Error('Two columns refer to the same field. Keep one column for each field.');
 if(!targets.includes('client_name')||!targets.includes('address'))throw Error('Use Client Name and Address columns in the first row.');
 if(!['mow','edge','mulch','hedge'].some(field=>targets.includes(field)))throw Error('Include a Mowing or Edging, Mulching or Hedge Maintenance column using Yes/No or TRUE/FALSE.');
 return rows.map(row=>Object.fromEntries(mapping.map(([key,target])=>[target,row[key]??''])));
}
export function lawnWorkbookRows(workbook,sheetName,XLSX){
 const sheet=workbook.Sheets[sheetName];if(!sheet)throw Error('Choose a worksheet from this workbook.');
 if(!sheet['!ref'])return {rows:[],warnings:[]};
 const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
 if(range.e.r>100)throw Error('Use a worksheet with a header and up to 100 job rows for this prototype.');
 if(range.e.c>49)throw Error('Use a worksheet with up to 50 columns.');
 const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:true,range:0});
 const headers=matrix[0]||[];
 const recognized=headers.map(lawnHeader).filter(Boolean);
 if(new Set(recognized).size!==recognized.length)throw Error('Two columns refer to the same field. Keep one column for each field.');
 const objects=[],locations=[];
 for(let index=1;index<matrix.length;index++){
  const values=matrix[index];if(!values.some(value=>String(value).trim()!==''))continue;
  objects.push(Object.fromEntries(headers.map((header,column)=>[String(header),values[column]??''])));locations.push(index+1);
 }
 const rows=normalizeLawnRows(objects),warnings=[];
 for(const [index,row]of rows.entries()){
  const sourceRow=locations[index];row.__source_row=sourceRow;row.__source_sheet=sheetName;
  for(const [column,header]of headers.entries()){
   if(!lawnHeader(header))continue;
   const cell=sheet[XLSX.utils.encode_cell({r:sourceRow-1,c:column})];
   if(cell?.f){
    if(cell.v===undefined||cell.v===null||cell.v==='')row.__formula_error='A formula has no saved result. Recalculate and save the workbook, or enter a value.';
    else warnings.push({row:sourceRow,severity:'review',message:'Using a saved formula result; verify this value before importing.'});
   }
  }
 }
 return {rows,warnings};
}

export function createLawnTemplate(XLSX){
 const workbook=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([
  ['Client ID','Client Name','Address','City','State','ZIP','Phone','Email','Mowing','Edging','Mulching','Hedge Maintenance','Job Price','Estimated Minutes','Crew','Latitude','Longitude'],
  ['NEW01','Sample Customer','12 Sample Lane','Cincinnati','OH','45201','202-555-0190','sample@example.com','Yes','Yes','No','No',85,45,'A','',''],
  ['NEW02','Another Sample Customer','28 Sample Avenue','Cincinnati','OH','45201','202-555-0191','another@example.com','Yes','No','No','No','','','B','','']
 ]);
 sheet['!cols']=[12,26,30,18,10,12,20,28,12,12,12,22,14,20,12,16,16].map(wch=>({wch}));sheet.M2.z='$0.00';
 XLSX.utils.book_append_sheet(workbook,sheet,'Customers');
 const instructions=XLSX.utils.aoa_to_sheet([
  ['Groundskeeper import template — fictional examples'],
  ['Replace the two sample customer rows with your own jobs before importing.'],
  ['Required: Client Name, Address, and at least one selected service.'],
  ['Services: Mowing, Edging, Mulching, Hedge Maintenance. Use Yes/No.'],
  ['Optional: City, State, ZIP, Phone, Email, Client ID, Job Price, Estimated Minutes, Crew.'],
  ['Leave Job Price blank to review it in Price studio. Zero is an explicit free job.'],
  ['Blank Estimated Minutes uses each requested service default plus setup once. Configure Mulching and Hedge Maintenance in Business settings first.'],
  ['An entered Estimated Minutes value is the total crew time for the visit and overrides the defaults. Review default estimates for property size and conditions.'],
  ['Mowing and Edging accept Yes/No, TRUE/FALSE, 1/0, or x/blank.'],
  ['Crew accepts A / Willow crew or B / Clover crew in the demo.'],
  ['Put headers in row 1. Choose the customer worksheet in the import screen.'],
  ['Up to 100 data rows per import, 150 visits in the demo day, and 5 MB per file.'],
  ['Formula results must be recalculated and saved in Excel before importing.'],
  ['Latitude and Longitude place customers on the street map. Supply both or leave both blank.'],
  ['Street-map coordinates come from your file and are not independently geocoded.'],
  ['Prices are owner-reviewed quotes; actual time updates modeled cost.'],
  ['Files are read in this browser. Imported jobs save to your private business account.']
 ]);instructions['!cols']=[{wch:108}];XLSX.utils.book_append_sheet(workbook,instructions,'Instructions');return workbook;
}
