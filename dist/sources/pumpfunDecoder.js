const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function toBase58(bytes) {
    let num = 0n;
    for (const b of bytes)
        num = num * 256n + BigInt(b);
    let out = '';
    while (num > 0n) {
        out = B58[Number(num % 58n)] + out;
        num /= 58n;
    }
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++)
        out = '1' + out;
    return out || '1';
}
/** TradeEvent : 8 (discriminator) + 32+8+8+1+32+8+8+8 = 113 octets minimum. */
const TRADE_MIN_LEN = 113;
function decodeTrade(buf) {
    if (buf.length < TRADE_MIN_LEN)
        return null;
    let o = 8;
    const mint = toBase58(buf.subarray(o, o + 32));
    o += 32;
    const solAmount = Number(buf.readBigUInt64LE(o));
    o += 8;
    const tokenAmount = Number(buf.readBigUInt64LE(o));
    o += 8;
    const buyByte = buf.readUInt8(o);
    o += 1;
    if (buyByte > 1)
        return null;
    const wallet = toBase58(buf.subarray(o, o + 32));
    o += 32;
    const ts = Number(buf.readBigInt64LE(o));
    o += 8;
    const virtualSolReserves = Number(buf.readBigUInt64LE(o));
    o += 8;
    const virtualTokenReserves = Number(buf.readBigUInt64LE(o));
    if (virtualTokenReserves <= 0 || virtualSolReserves <= 0)
        return null;
    if (ts < 1_600_000_000 || ts > 4_000_000_000)
        return null;
    if (solAmount <= 0 || tokenAmount <= 0)
        return null;
    return {
        type: 'trade',
        mint,
        wallet,
        isBuy: buyByte === 1,
        solAmount,
        tokenAmount,
        virtualSolReserves,
        virtualTokenReserves,
    };
}
function readStr(buf, o) {
    if (o + 4 > buf.length)
        return null;
    const len = buf.readUInt32LE(o);
    if (len > 200 || o + 4 + len > buf.length)
        return null;
    return { value: buf.subarray(o + 4, o + 4 + len).toString('utf8'), next: o + 4 + len };
}
function decodeCreate(buf) {
    let o = 8;
    const name = readStr(buf, o);
    if (!name)
        return null;
    o = name.next;
    const symbol = readStr(buf, o);
    if (!symbol)
        return null;
    o = symbol.next;
    const uri = readStr(buf, o);
    if (!uri)
        return null;
    o = uri.next;
    if (o + 96 > buf.length)
        return null;
    const mint = toBase58(buf.subarray(o, o + 32));
    o += 32;
    const bondingCurve = toBase58(buf.subarray(o, o + 32));
    o += 32;
    const creator = toBase58(buf.subarray(o, o + 32));
    if (!symbol.value || !mint)
        return null;
    return { type: 'create', mint, name: name.value, symbol: symbol.value, uri: uri.value, creator, bondingCurve };
}
export function decodeProgramData(base64) {
    try {
        const buf = Buffer.from(base64, 'base64');
        if (buf.length < 16)
            return null;
        return decodeTrade(buf) ?? decodeCreate(buf);
    }
    catch {
        return null;
    }
}
/** Extrait les events des lignes « Program data: <base64> ». */
export function decodeLogs(logs) {
    const out = [];
    for (const line of logs) {
        const i = line.indexOf('Program data: ');
        if (i === -1)
            continue;
        const ev = decodeProgramData(line.slice(i + 14).trim());
        if (ev)
            out.push(ev);
    }
    return out;
}
