export interface BybitResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: Array<{
      symbol: string;
      lastPrice: string;
      indexPrice: string;
      markPrice: string;
      prevPrice24h: string;
      price24hPcnt: string;
      highPrice24h: string;
      lowPrice24h: string;
      prevPrice1h: string;
      openInterest: string;
      openInterestValue: string;
      turnover24h: string;
      volume24h: string;
      fundingRate: string;
      nextFundingTime: string;
      predictedDeliveryPrice: string;
      basisRate: string;
      deliveryFeeRate: string;
      deliveryTime: string;
      ask1Size: string;
      bid1Price: string;
      ask1Price: string;
      bid1Size: string;
      basis: string;
    }>;
  };
  retExtInfo: Record<string, unknown>;
  time: number;
}

export interface BybitInstrumentsResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: Array<{
      symbol: string;
      contractType: string;
      status: string;
      baseCoin: string;
      quoteCoin: string;
      launchTime: string;
      deliveryTime: string;
      deliveryFeeRate: string;
      priceScale: string;
      leverageFilter: {
        minLeverage: string;
        maxLeverage: string;
        leverageStep: string;
      };
      priceFilter: {
        minPrice: string;
        maxPrice: string;
        tickSize: string;
      };
      lotSizeFilter: {
        maxOrderQty: string;
        maxMktOrderQty: string;
        minOrderQty: string;
        qtyStep: string;
        postOnlyMaxOrderQty: string;
        minNotionalValue: string;
      };
      unifiedMarginTrade: boolean;
      fundingInterval: number;
      settleCoin: string;
      copyTrading: string;
      upperFundingRate: string;
      lowerFundingRate: string;
    }>;
    nextPageCursor: string;
  };
  retExtInfo: Record<string, unknown>;
  time: number;
}
