// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EndpointRegistry} from "../src/EndpointRegistry.sol";
import {TestSupport} from "./TestSupport.sol";

/// @dev Independent state model. Random successful owner operations are interleaved with attacks.
contract RegistryHandler is TestSupport {
    EndpointRegistry public immutable registry;
    address internal constant ATTACKER = address(0xBAD);
    bytes32[] public ids;
    mapping(bytes32 => EndpointRegistry.Resource) internal model;
    uint256 public successfulChanges;
    uint256 public rejectedAttacks;

    constructor(EndpointRegistry registry_) {
        registry = registry_;
        register(0, 0);
    }

    function _actor(uint256 seed) internal pure returns (address) {
        return address(uint160(0xA1100 + seed % 3));
    }

    function _id(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    function expected(bytes32 id) external view returns (EndpointRegistry.Resource memory) {
        return model[id];
    }

    function count() external view returns (uint256) {
        return ids.length;
    }

    function register(uint256 actorSeed, uint256 uuidSeed) public {
        address owner = _actor(actorSeed);
        bytes16 uuid = bytes16(uint128(uuidSeed % 4 + 1));
        bytes32 id = registry.deriveResourceId(owner, uuid);
        if (model[id].owner != address(0)) {
            vm.prank(owner);
            (bool ok, bytes memory reason) = address(registry)
                .call(
                    abi.encodeCall(
                        registry.register, (uuid, owner, owner, uint96(1), bytes32(uint256(1)), true)
                    )
                );
            assertTrue(!ok);
            assertEq(
                keccak256(reason),
                keccak256(abi.encodeWithSelector(EndpointRegistry.AlreadyRegistered.selector, id))
            );
            ++rejectedAttacks;
            return;
        }
        vm.prank(owner);
        registry.register(uuid, owner, owner, 1, bytes32(uint256(1)), true);
        ids.push(id);
        model[id] = EndpointRegistry.Resource(owner, 1, true, owner, 1, bytes32(uint256(1)), address(0));
        ++successfulChanges;
    }

    function update(uint256 seed, uint96 rawPrice, bool enabled) public {
        bytes32 id = _id(seed);
        EndpointRegistry.Resource storage r = model[id];
        uint96 price = (rawPrice % 999_999_999_999) + 1;
        address payout = _actor(seed);
        bytes32 config = keccak256(abi.encode(seed, r.version));
        if (config == bytes32(0)) config = bytes32(uint256(1));
        vm.prank(r.owner);
        registry.updateConfiguration(id, r.version, payout, price, config, enabled);
        r.priceAtomic = price;
        r.payout = payout;
        r.configHash = config;
        r.enabled = enabled;
        ++r.version;
        ++successfulChanges;
    }

    function disable(uint256 seed) public {
        bytes32 id = _id(seed);
        EndpointRegistry.Resource storage r = model[id];
        if (!r.enabled) return;
        vm.prank(r.owner);
        registry.disable(id, r.version);
        r.enabled = false;
        ++r.version;
        ++successfulChanges;
    }

    function nominate(uint256 seed, uint256 actorSeed) public {
        bytes32 id = _id(seed);
        EndpointRegistry.Resource storage r = model[id];
        address next = _actor(actorSeed);
        if (next == r.owner || next == r.pendingOwner) return;
        vm.prank(r.owner);
        registry.transferOwnership(id, r.version, next);
        r.pendingOwner = next;
        ++r.version;
        ++successfulChanges;
    }

    function cancel(uint256 seed) public {
        bytes32 id = _id(seed);
        EndpointRegistry.Resource storage r = model[id];
        if (r.pendingOwner == address(0)) return;
        vm.prank(r.owner);
        registry.cancelOwnershipTransfer(id, r.version);
        r.pendingOwner = address(0);
        ++r.version;
        ++successfulChanges;
    }

    function accept(uint256 seed) public {
        bytes32 id = _id(seed);
        EndpointRegistry.Resource storage r = model[id];
        if (r.pendingOwner == address(0)) return;
        vm.prank(r.pendingOwner);
        registry.acceptOwnership(id, r.version);
        r.owner = r.pendingOwner;
        r.pendingOwner = address(0);
        ++r.version;
        ++successfulChanges;
    }

    function attack(uint256 seed, uint256 method) public {
        bytes32 id = _id(seed);
        EndpointRegistry.Resource memory r = model[id];
        bytes memory data;
        uint256 which = method % 6;
        if (which == 0) {
            data = abi.encodeCall(registry.disable, (id, r.version));
        } else if (which == 1) {
            data = abi.encodeCall(
                registry.updateConfiguration, (id, r.version, ATTACKER, 1, bytes32(uint256(2)), true)
            );
        } else if (which == 2) {
            data = abi.encodeCall(registry.transferOwnership, (id, r.version, ATTACKER));
        } else if (which == 3) {
            data = abi.encodeCall(registry.acceptOwnership, (id, r.version));
        } else if (which == 4) {
            data = abi.encodeCall(registry.cancelOwnershipTransfer, (id, r.version));
        } else {
            data = abi.encodeCall(
                registry.register, (bytes16(uint128(5)), r.owner, ATTACKER, 1, bytes32(uint256(1)), true)
            );
        }
        bytes32 beforeHash = keccak256(abi.encode(registry.getResource(id)));
        vm.prank(ATTACKER);
        (bool ok, bytes memory reason) = address(registry).call(data);
        assertTrue(!ok);
        assertEq(keccak256(reason), keccak256(abi.encodeWithSelector(EndpointRegistry.Unauthorized.selector)));
        assertEq(keccak256(abi.encode(registry.getResource(id))), beforeHash);
        ++rejectedAttacks;
    }

    function staleWrite(uint256 seed) public {
        bytes32 id = _id(seed);
        EndpointRegistry.Resource memory r = model[id];
        vm.prank(r.owner);
        (bool ok, bytes memory reason) =
            address(registry).call(abi.encodeCall(registry.disable, (id, r.version - 1)));
        assertTrue(!ok);
        assertEq(
            keccak256(reason),
            keccak256(
                abi.encodeWithSelector(EndpointRegistry.VersionMismatch.selector, r.version - 1, r.version)
            )
        );
        ++rejectedAttacks;
    }

    function sendEther(uint96 rawValue) public {
        uint256 value = uint256(rawValue) + 1;
        vm.deal(ATTACKER, value);
        vm.prank(ATTACKER);
        (bool ok,) = address(registry).call{value: value}("");
        assertTrue(!ok);
        assertEq(ATTACKER.balance, value);
        assertEq(address(registry).balance, 0);
        ++rejectedAttacks;
    }
}

contract EndpointRegistryInvariantTest is TestSupport {
    EndpointRegistry internal registry;
    RegistryHandler internal handler;

    function setUp() public {
        registry = new EndpointRegistry();
        handler = new RegistryHandler(registry);
        // Exercise each transition at least once before randomized sequences.
        handler.nominate(0, 1);
        handler.cancel(0);
        handler.nominate(0, 1);
        handler.accept(0);
        handler.disable(0);
        handler.update(0, 123, true);
        for (uint256 i; i < 6; ++i) {
            handler.attack(0, i);
        }
        handler.staleWrite(0);
        handler.sendEther(1);
    }

    /// @dev Native Forge discovery interface, equivalent to StdInvariant's targetContracts getter.
    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariantAuthorizedStateMatchesIndependentModel() public view {
        for (uint256 i; i < handler.count(); ++i) {
            bytes32 id = handler.ids(i);
            assertEq(
                keccak256(abi.encode(registry.getResource(id))), keccak256(abi.encode(handler.expected(id)))
            );
        }
    }

    function invariantValidConfigurationAndNoLostOwner() public view {
        for (uint256 i; i < handler.count(); ++i) {
            EndpointRegistry.Resource memory r = registry.getResource(handler.ids(i));
            assertTrue(r.owner != address(0) && r.payout != address(0));
            assertTrue(r.configHash != bytes32(0));
            assertTrue(r.priceAtomic > 0 && r.priceAtomic <= 999_999_999_999);
            assertTrue(r.pendingOwner == address(0) || r.pendingOwner != r.owner);
        }
    }

    function invariantVersionsCountExactlySuccessfulChanges() public view {
        uint256 sum;
        for (uint256 i; i < handler.count(); ++i) {
            sum += registry.getResource(handler.ids(i)).version;
        }
        assertEq(sum, handler.successfulChanges());
        assertTrue(handler.rejectedAttacks() >= 8);
    }

    /// @dev Applies to ordinary calls in the campaign, not EVM-forced ETH or unsolicited ERC-20 transfers.
    function invariantNoEtherAcceptedOrDistributed() public view {
        assertEq(address(registry).balance, 0);
        assertEq(address(0xA1100).balance, 0);
        assertEq(address(0xA1101).balance, 0);
        assertEq(address(0xA1102).balance, 0);
    }
}
