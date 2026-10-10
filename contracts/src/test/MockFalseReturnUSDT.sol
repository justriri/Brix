// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Test-only ERC20 that returns `false` instead of reverting on transfer/
 * transferFrom (some real, non-malicious tokens historically did this —
 * exactly the "false-return ERC20" case named in the settlement audit's
 * adversarial test list, section 16). Used to confirm WeekendGuardSettlement
 * relies on SafeERC20 (which checks the boolean return value and reverts
 * the whole transaction on `false`, not just on a revert) rather than a raw
 * `IERC20.transfer()` call that would silently treat `false` as success.
 */
contract MockFalseReturnUSDT {
    string public constant name = "Mock False-Return USDT";
    string public constant symbol = "mfUSDT";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /** Deliberately returns false instead of moving any funds or reverting. */
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }

    /** Deliberately returns false instead of moving any funds or reverting. */
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}
