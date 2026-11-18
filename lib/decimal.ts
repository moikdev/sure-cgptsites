// Fixed-point strings keep fractional securities away from binary floating point.
export const QTY_SCALE=18, PRICE_SCALE=10;
export const pow10=(places:number)=>10n**BigInt(places);
export function decimalAtoms(input:string,places:number,maxIntegerDigits=16):bigint {
  const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if(!match)throw new Error('Use a decimal number without separators or exponent notation.');
  const integer=match[2].replace(/^0+(?=\d)/,''),fraction=(match[3]??'').replace(/0+$/,'');
  if(integer.length>maxIntegerDigits)throw new Error('The decimal value is too large.');
  if(fraction.length>places)throw new Error(`Use at most ${places} decimal places.`);
  const value=BigInt(integer)*pow10(places)+BigInt(fraction.padEnd(places,'0')||'0');return match[1]?-value:value;
}
export function decimalString(value:bigint,places:number):string {const sign=value<0n?'-':'',digits=(value<0n?-value:value).toString().padStart(places+1,'0');if(!places)return sign+digits;const fraction=digits.slice(-places).replace(/0+$/,'');return sign+digits.slice(0,-places)+(fraction?'.'+fraction:'');}
export function canonicalDecimal(value:string,places:number){return decimalString(decimalAtoms(value,places),places);}
export function roundDivide(numerator:bigint,denominator:bigint):bigint {if(denominator<=0n)throw new Error('Invalid decimal denominator.');return numerator<0n?-roundDivide(-numerator,denominator):(numerator+denominator/2n)/denominator;}
export function safeMinorUnits(value:bigint,max=Number.MAX_SAFE_INTEGER):number {if(value>BigInt(max)||value< -BigInt(max))throw new Error('The calculated value exceeds the supported money range.');return Number(value);}
export function quantityValue(qty:string,price:string,places:number){return safeMinorUnits(roundDivide(decimalAtoms(qty,QTY_SCALE)*decimalAtoms(price,PRICE_SCALE),pow10(QTY_SCALE+PRICE_SCALE-places)));}
export function priceNumber(value:string){return Number(value);} // Display/chart coordinates only; never accounting.
