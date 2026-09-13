/** Constantes on-chain pump.fun + pondérations de scoring. */
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const TOKEN_DECIMALS = 6;
export const TOTAL_SUPPLY = 1_000_000_000;
/** Réserves initiales de la bonding curve pump.fun (unités entières de token). */
export const INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_191;
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000;
/** Programme pump.fun. À revérifier si pump.fun redéploie. */
export const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
/** Seuils de niveau d'alerte (spec produit). */
export const LEVEL_THRESHOLDS = {
    WATCHLIST: 65,
    SIGNAL: 75,
    A: 82,
    A_PLUS: 90,
};
export const PRE_WEIGHTS = {
    volume: 20,
    smartWallets: 20,
    momentum: 15,
    buyers: 15,
    distribution: 10,
    dev: 10,
    narrative: 10,
};
export const POST_WEIGHTS = {
    volume: 25,
    smartWallets: 20,
    holders: 15,
    buySell: 15,
    narrative: 15,
    liquidity: 10,
};
export const REENTRY_WEIGHTS = {
    volumeRecovery: 25,
    drawdown: 20,
    holders: 15,
    uniqueBuyers: 15,
    buySell: 15,
    smartWallets: 10,
};
