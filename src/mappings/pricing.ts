/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD, UNTRACKED_PAIRS } from './helpers'

const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'
const WETH_USDC_PAIR = '0xa0b5846550740c153ec7d18886b644c2d6da45c8'

export function getEthPriceInUSD(): BigDecimal {
  let usdcPair = Pair.load(WETH_USDC_PAIR)

  if (usdcPair !== null) {
    return usdcPair.token0Price // USDC is token0 on OP
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  WETH_ADDRESS,
  '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', // USDT
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC
  '0x7f5c764cbc14f9669b88837ca1490cca17c31607', // USDC.e
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
  '0x2e3d870790dc77a83dd1d18184acc7439a53f475', // FRAX
  '0x73cb180bf0521828d8849bc8cf2b920918e23032', // USD+
  '0x8ae125e8653821e851f12a49f7765db9a9ce7384', // DOLA
  '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9', // sUSD
  '0x68f180fcce6836688e9084f035309e29bf0a2095', // WBTC
  '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', // LINK
  '0xdc6ff44d5d932cbd77b52e5612ba0529dc6226f1', // WLD
  '0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40', // tBTC
  '0xaddb6a0412de1ba0f936dcaeb8aaa24578dcf3b2', // cbETH
  '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb', // wstETH
  '0x4200000000000000000000000000000000000042', // OP
  '0x2416092f143378750bb29b79ed961ab195cceea5', // ezETH
  '0x484c2d6e3cdd945a8b2df735e079178c1036578c', // sfrxETH
  '0x6806411765af15bddd26f8f544a34cc40cb9838b', // frxETH
  '0x67ccea5bb16181e7b4109c9c2143c24a1c2205be', // FXS
  '0x99c59acebfef3bbfb7129dc90d1a11db0e91187f', // PYTH
  '0xfdb794692724153d1488ccdbe0c56c252596735f', // LDO
  '0xb0ffa8000886e57f86dd5264b9582b2ad87b2b91', // W
  '0xbc7b1ff1c6989f006a1185318ed4e7b5796e66e1', // PENDLE
  '0xad42d013ac31486b73b6b059e748172994736426', // 1INCH
  '0xfe8b128ba8c78aabc59d4c64cee7ff28e9379921', // BAL
  '0x8700daec35af8ff88c16bdf0418774cb3d7599b4', // SNX
  '0x871f2f2ff935fd1ed867842ff2a7bfd051a5e527', // WOO
  '0xc81d1f0eb955b0c020e5d5b264e1ff72c14d1401', // RPL
  '0x9046d36440290ffde54fe0dd84db8b1cfee9107b', // YFI
  '0xa00e3a3511aac35ca78530c85007afcd31753819', // KNC
  '0x3c8b650257cfb5f272f799f5e2b4e65093a11a05', // VELO
  '0x6985884c4392d348587b19cb9eaaf157f13271cd', // ZRO
  '0xfb21b70922b9f6e3c6274bcd6cb1aa8a0fe20b80', // UST
  '0x58b9cb810a68a7f3e1e4f8cb45d1b9b3c79705e8' // NEXT
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('100')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('0')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair!.token0 == token.id && pair!.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair!.token1)
        return pair!.token1Price.times(token1!.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair!.token1 == token.id && pair!.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair!.token0)
        return pair!.token0Price.times(token0!.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH!.times(bundle!.ethPrice)
  let price1 = token1.derivedETH!.times(bundle!.ethPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedETH!.times(bundle!.ethPrice)
  let price1 = token1.derivedETH!.times(bundle!.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
