require("dotenv").config()
const fs = require("fs")
const path = require("path")
const axios = require("axios")
const nearApi = require("near-api-js")

// TODO:
// - get DAO txns
// - format TXN to json 
// - parse into CSV 
// - write to file 

const NEAR_ENV = process.env.NEAR_ENV || 'mainnet'
const RPC = 'https://rpc.mainnet.near.org'

const formatNearAmtPrecision = (amount, digits = 2) => {
  const raw = nearApi.utils.format.formatNearAmount(amount)
  return parseFloat(raw).toFixed(digits)
}

const getNearPrice = async () => {
  const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd')
  return data && data.near && data.near.usd ? `${data.near.usd}` : ""
}

function getConfigByType(networkId, config) {
  return {
    networkId,
    nodeUrl: networkId !== 'guildnet' ? `https://rpc.${networkId}.near.org` : 'https://rpc.openshards.io',
    explorerUrl: `https://explorer.${networkId === 'mainnet' ? '' : networkId + '.'}near.org`,
    walletUrl: `https://wallet.${networkId === 'mainnet' ? '' : networkId + '.'}near.org`,
    helperUrl: `https://helper.${networkId}.near.org`,
    ...config,
  }
}

function getConfig(env, options = {}) {
  switch (env) {
    case 'production':
    case 'mainnet':
      return getConfigByType('mainnet', options)
    case 'development':
    case 'testnet':
      return getConfigByType('testnet', options)
    case 'betanet':
      return getConfigByType('betanet', options)
    case 'guildnet':
      return getConfigByType('guildnet', options)
    case 'local':
      return {
        ...options,
        networkId: 'local',
        nodeUrl: 'http://localhost:3030',
        keyPath: `${process.env.HOME}/.near/validator_key.json`,
        walletUrl: 'http://localhost:4000/wallet',
      }
    default:
      throw Error(`Unconfigured environment '${env}'. Can be configured in src/config.js.`)
  }
}

const queryRpc = async (_near, account_id, method, args) => {
  // load contract based on abis & type
  let res

  try {
    const payload = Buffer.from(JSON.stringify(args || {}), "ascii")
    res = await _near.connection.provider.query({
      request_type: 'call_function',
      finality: 'final',
      account_id,
      method_name: method,
      // args_base64: btoa(JSON.stringify(args || {})),
      args_base64: payload.toString('base64'),
    })
  } catch (e) {
    return
  }

  return JSON.parse(Buffer.from(res.result).toString());
}


// GOOOOOO!!
;(async () => {
  // const $near = await nearApi.connect(Object.assign({ deps: { keyStore: this.keystore } }, this.config))
  const config = getConfig('mainnet', {})
  const $near = await nearApi.connect(Object.assign({ deps: { keyStore: {} } }, config))
  const DAO_NAME = 'genesis.sputnik-dao.near'
  
  //near view ecosystem.sputnik-dao.near get_proposals '{"from_index":0,"limit":300}'
  const proposals = await queryRpc($near, DAO_NAME, 'get_proposals', { "from_index": 0, "limit": 300})
  // console.log('HERE', JSON.stringify(proposals))

  const nearPrice = await getNearPrice()

  // Format the response:
  // {
  //   "id": 4,
  //   "proposer": "niaguild.near",
  //   "description": "NIA October Payout$$$$https://gov.near.org/t/nia-october-2021-progress-report/8714?u=chronear",
  //   "kind": {
  //     "Transfer": {
  //       "token_id": "",
  //       "receiver_id": "near-intelligence-collective.sputnik-dao.near",
  //       "amount": "2500000000000000000000000000",
  //       "msg": null
  //     }
  //   },
  //   "status": "Approved",
  //   "vote_counts": {
  //     "Council": [
  //       2,
  //       0,
  //       0
  //     ]
  //   },
  //   "votes": {
  //     "thegrace.near": "Approve",
  //     "james.near": "Approve"
  //   },
  //   "submission_time": "1636481364829610822"
  // }
  let csv = `submission_time,id,proposer,status,kind,receiver_id,raw_amount,formatted_amount,token_id,near_price,vote_approve,vote_reject,vote_remove,description`
  proposals.forEach(p => {
    const ts = new Date(p.submission_time / 1000000).toISOString()
    let receive_id = ''
    let transfer_amount = ''
    let transfer_token_id = ''
    let near_price = nearPrice || ''
    let vote_approve = 0, vote_reject = 0, vote_remove = 0

    // get teh data about payout
    if (p.kind && p.kind.Transfer) {
      const tr = p.kind.Transfer
      receive_id = tr.receive_id
      transfer_amount = tr.amount
      if (tr.token_id) transfer_token_id = tr.token_id
    }

    // tally the votes
    Object.keys(p.votes).forEach(v => {
      if (p.votes[v] === 'Approve') vote_approve += 1
      if (p.votes[v] === 'Reject') vote_reject += 1
      if (p.votes[v] === 'Remove') vote_remove += 1
    })

    // add that line
    csv += `${ts},${p.id},${p.proposer},${p.status},${Object.keys(p.kind)},${receive_id},${transfer_amount},${formatNearAmtPrecision(transfer_amount, 2)},${transfer_token_id},${near_price},${vote_approve},${vote_reject},${vote_remove},"${p.description.replace(/\$\$\$\$/g, ' ').replace(/^\s*\n/gm, '').replace(/\n/gm, '  ')}"\n`
  })

  // console.log('CSV', csv)
  fs.writeFileSync(`DAO_REPORT_${DAO_NAME}_${new Date().toISOString()}.csv`, csv)
})()