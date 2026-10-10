// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Test-only 18-decimal mock USDT (matches the REAL BSC Binance-Peg USDT,
 * live-verified via a direct on-chain decimals()/symbol() read against
 * 0x55d398326f99059ff775485246999027b3197955 — see SETTLEMENT.md "reserve
 * asset"). Used ONLY by the Hardhat test suite; never deployed anywhere
 * real. `mint` is unrestricted on purpose — it is not part of
 * WeekendGuardSettlement and has no production use.
 */
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock Tether USD", "mUSDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
