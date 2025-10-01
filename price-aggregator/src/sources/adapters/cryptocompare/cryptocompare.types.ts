export interface CryptoCompareTickerData {
  TYPE: string;
  MARKET: string;
  FROMSYMBOL: string;
  TOSYMBOL: string;
  FLAGS: string;
  PRICE?: number;
  BID?: number;
  OFFER?: number;
  LASTUPDATE?: number;
  MEDIAN?: number;
  LASTVOLUME?: number;
  LASTVOLUMETO?: number;
  LASTTRADEID?: string;
  VOLUMEDAY?: number;
  VOLUMEDAYTO?: number;
  VOLUME24HOUR?: number;
  VOLUME24HOURTO?: number;
  OPENDAY?: number;
  HIGHDAY?: number;
  LOWDAY?: number;
  OPEN24HOUR?: number;
  HIGH24HOUR?: number;
  LOW24HOUR?: number;
  LASTMARKET?: string;
}

export interface CryptoCompareStreamMessage {
  TYPE: string;
  MESSAGE?: string;
  PARAMETER?: string;
  INFO?: string;
}

export interface CryptoCompareSubscription {
  action: 'SubAdd' | 'SubRemove';
  subs: string[];
}

export type CryptoCompareMessageType =
  | '0' // TRADE
  | '1' // FEEDNEWS
  | '2' // CURRENT
  | '3' // LOADCOMPLETE
  | '4' // COINPAIRS
  | '5' // CURRENTAGG
  | '6' // TOPLIST
  | '7' // TOPLISTCHANGE
  | '8' // ORDERBOOK
  | '9' // FULLORDERBOOK
  | '10' // ACTIVATION
  | '11' // FULLVOLUME
  | '16' // TRADECATCHUP
  | '17' // NEWSCATCHUP
  | '18' // TRADECATCHUPCOMPLETE
  | '19' // NEWSCATCHUPCOMPLETE
  | '20' // INFO
  | '21' // PING
  | '22' // PONG
  | '23' // HEARTBEAT
  | '24' // CANDLE
  | '999'; // STREAMMESSAGE

export const MESSAGE_TYPES = {
  TRADE: '0',
  CURRENT: '2',
  CURRENTAGG: '5',
  HEARTBEAT: '999',
  ERROR: '500',
  TOO_MANY_SUBSCRIPTIONS: '429',
} as const;
