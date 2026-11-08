import {hasCoordinates} from './lawn-geo.js';

export function normalizeServiceAddress(value){
 if(typeof value!=='string'||value.length>240||/[\u0000-\u001f\u007f]/.test(value))throw Error('Enter a street address of up to 240 characters.');
 const address=value.trim().replace(/\s+/g,' ');
 if(address.length<8||!/[0-9]/.test(address)||!/[a-z]/i.test(address)||/^P\.?\s*O\.?\s*Box\b/i.test(address))throw Error('Enter a street number and street name, with city, state and ZIP for the best match.');
 return address;
}
export const serviceAddressKey=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
export function addressLocationMatches(location,address){
 return !!location&&location.addressKey===serviceAddressKey(address)&&hasCoordinates(location);
}
export function parseAddressLookup(payload,address){
 if(!payload||!Array.isArray(payload.matches)||payload.matches.length>5||payload.provider!=='U.S. Census Geocoder'||!Number.isFinite(Date.parse(payload.fetchedAt)))throw Error('Address lookup returned an incomplete result. Try again.');
 return payload.matches.map(match=>{
  if(!hasCoordinates(match)||typeof match.matchedAddress!=='string'||!match.matchedAddress.trim()||match.matchedAddress.length>300)throw Error('Address lookup returned an invalid location. Try again.');
  return {...match,addressKey:serviceAddressKey(address),provider:payload.provider,precision:'Street address range estimate',fetchedAt:payload.fetchedAt};
 });
}
