// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EndpointRegistry} from "../src/EndpointRegistry.sol";
import {TestSupport, Vm} from "./TestSupport.sol";

contract EndpointRegistryTest is TestSupport {
    EndpointRegistry internal registry;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA401);
    bytes16 internal constant UUID = 0x8dc286d78b04441196a0422aad965f31;
    bytes32 internal constant CONFIG = keccak256("local opaque configuration commitment");
    bytes32 internal id;

    function setUp() public {
        registry = new EndpointRegistry();
        id = registry.deriveResourceId(ALICE, UUID);
    }

    function _register() internal {
        vm.prank(ALICE);
        assertEq(registry.register(UUID, ALICE, BOB, 1_000_000, CONFIG, true), id);
    }

    function _snapshot() internal view returns (bytes32) {
        return keccak256(abi.encode(registry.getResource(id)));
    }

    function testCrossLanguageMappingVector() public {
        // Independently reproduced with existing viem 2.57.13. This salt is public local fixture data.
        assertEq(id, 0x8cceed2c37972681854cf4182a58d3364ae687fb42eb43f5907be00ff2928412);
        bytes32 hash = keccak256(
            abi.encode(
                keccak256("SignalArcGate.EndpointConfig.v1"),
                id,
                keccak256(bytes("https://api.example.com/v1/data")),
                uint8(1),
                uint32(65536),
                uint8(0),
                bytes32(0x1111111111111111111111111111111111111111111111111111111111111111)
            )
        );
        assertEq(hash, 0xe21af1340a6f9664cc72f413627d5b14dd7e44a37ecb3cdc868014badf58594d);
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 1, hash, true);
        assertEq(registry.getResource(id).configHash, hash);
    }

    function testRegisterAndRead() public {
        _register();
        EndpointRegistry.Resource memory r = registry.getResource(id);
        assertEq(r.owner, ALICE);
        assertEq(r.payout, BOB);
        assertEq(r.priceAtomic, 1_000_000);
        assertEq(r.configHash, CONFIG);
        assertEq(r.version, 1);
        assertEq(r.pendingOwner, address(0));
        assertTrue(r.enabled);
        assertEq(registry.CHAIN_ID(), 8453);
        assertEq(registry.MAX_PRICE_ATOMIC(), 999_999_999_999);
    }

    function testRegisterDisabled() public {
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 1, CONFIG, false);
        assertTrue(!registry.getResource(id).enabled);
        assertEq(registry.getResource(id).version, 1);
    }

    function testDuplicateCannotOverwrite() public {
        _register();
        bytes32 beforeHash = _snapshot();
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.AlreadyRegistered.selector, id));
        vm.prank(ALICE);
        registry.register(UUID, ALICE, CAROL, 2, CONFIG, false);
        assertEq(_snapshot(), beforeHash);
    }

    function testCannotRegisterForAnotherOwner() public {
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(BOB);
        registry.register(UUID, ALICE, BOB, 1, CONFIG, true);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.ResourceNotFound.selector, id));
        registry.getResource(id);
    }

    function testNamespacesPreventIdentifierSquatting() public {
        vm.prank(BOB);
        bytes32 otherId = registry.register(UUID, BOB, BOB, 1, CONFIG, true);
        _register();
        assertTrue(otherId != id);
        assertEq(registry.getResource(otherId).owner, BOB);
        assertEq(registry.getResource(id).owner, ALICE);
    }

    function testZeroOwnerRejected() public {
        vm.expectRevert(EndpointRegistry.ZeroAddress.selector);
        registry.register(UUID, address(0), BOB, 1, CONFIG, true);
    }

    function testZeroUuidRejected() public {
        vm.expectRevert(EndpointRegistry.InvalidResourceId.selector);
        vm.prank(ALICE);
        registry.register(bytes16(0), ALICE, BOB, 1, CONFIG, true);
    }

    function testZeroPayoutRejected() public {
        vm.expectRevert(EndpointRegistry.ZeroAddress.selector);
        vm.prank(ALICE);
        registry.register(UUID, ALICE, address(0), 1, CONFIG, true);
    }

    function testZeroCommitmentRejected() public {
        vm.expectRevert(EndpointRegistry.InvalidConfigHash.selector);
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 1, bytes32(0), true);
    }

    function testZeroPriceRejected() public {
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.InvalidPrice.selector, uint96(0)));
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 0, CONFIG, true);
    }

    function testAboveMaximumPriceRejected() public {
        vm.expectRevert(
            abi.encodeWithSelector(EndpointRegistry.InvalidPrice.selector, uint96(1_000_000_000_000))
        );
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 1_000_000_000_000, CONFIG, true);
    }

    function testMaximumPriceAccepted() public {
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 999_999_999_999, CONFIG, true);
        assertEq(registry.getResource(id).priceAtomic, 999_999_999_999);
    }

    function testMinimumPriceAccepted() public {
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 1, CONFIG, true);
        assertEq(registry.getResource(id).priceAtomic, 1);
    }

    function testOwnerUpdateAndVersion() public {
        _register();
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, CAROL, 7, keccak256("updated"), false);
        EndpointRegistry.Resource memory r = registry.getResource(id);
        assertEq(r.owner, ALICE);
        assertEq(r.payout, CAROL);
        assertEq(r.priceAtomic, 7);
        assertEq(r.configHash, keccak256("updated"));
        assertEq(r.version, 2);
        assertTrue(!r.enabled);
    }

    function testUpdateValidationPreservesState() public {
        _register();
        bytes32 beforeHash = _snapshot();
        vm.expectRevert(EndpointRegistry.ZeroAddress.selector);
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, address(0), 1, CONFIG, true);
        vm.expectRevert(EndpointRegistry.InvalidConfigHash.selector);
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, BOB, 1, bytes32(0), true);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.InvalidPrice.selector, type(uint96).max));
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, BOB, type(uint96).max, CONFIG, true);
        assertEq(_snapshot(), beforeHash);
    }

    function testStaleVersionCannotOverwriteNewConfiguration() public {
        _register();
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, BOB, 2, CONFIG, true);
        bytes32 beforeHash = _snapshot();
        vm.expectRevert(
            abi.encodeWithSelector(EndpointRegistry.VersionMismatch.selector, uint64(1), uint64(2))
        );
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, BOB, 3, CONFIG, true);
        assertEq(_snapshot(), beforeHash);
    }

    function testVersionOverflowFailsClosed() public {
        _register();
        // Test-only boundary injection using the documented packed mapping slot.
        bytes32 slot = keccak256(abi.encode(id, uint256(0)));
        uint256 packed = uint256(uint160(ALICE)) | (uint256(type(uint64).max) << 160) | (uint256(1) << 224);
        vm.store(address(registry), slot, bytes32(packed));
        bytes32 beforeHash = _snapshot();
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        vm.prank(ALICE);
        registry.disable(id, type(uint64).max);
        assertEq(_snapshot(), beforeHash);
    }

    function testEveryOwnerMutationRejectsStaleVersions() public {
        _register();
        vm.prank(ALICE);
        registry.transferOwnership(id, 1, BOB);
        bytes32 beforeHash = _snapshot();
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(registry.disable, (id, 1));
        calls[1] = abi.encodeCall(registry.updateConfiguration, (id, 1, BOB, 2, CONFIG, true));
        calls[2] = abi.encodeCall(registry.transferOwnership, (id, 1, CAROL));
        calls[3] = abi.encodeCall(registry.cancelOwnershipTransfer, (id, 1));
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(ALICE);
            (bool ok, bytes memory reason) = address(registry).call(calls[i]);
            assertTrue(!ok);
            assertEq(
                keccak256(reason),
                keccak256(
                    abi.encodeWithSelector(EndpointRegistry.VersionMismatch.selector, uint64(1), uint64(2))
                )
            );
            assertEq(_snapshot(), beforeHash);
        }
    }

    function testNoOpUpdateDoesNotBumpVersion() public {
        _register();
        vm.expectRevert(EndpointRegistry.NoConfigurationChange.selector);
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, BOB, 1_000_000, CONFIG, true);
        assertEq(registry.getResource(id).version, 1);
    }

    function testUnauthorizedMutationsPreserveState() public {
        _register();
        bytes32 beforeHash = _snapshot();
        bytes[] memory calls = new bytes[](5);
        calls[0] = abi.encodeCall(registry.updateConfiguration, (id, 1, BOB, 2, CONFIG, true));
        calls[1] = abi.encodeCall(registry.disable, (id, 1));
        calls[2] = abi.encodeCall(registry.transferOwnership, (id, 1, CAROL));
        calls[3] = abi.encodeCall(registry.cancelOwnershipTransfer, (id, 1));
        calls[4] = abi.encodeCall(registry.acceptOwnership, (id, 1));
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(BOB);
            (bool ok, bytes memory reason) = address(registry).call(calls[i]);
            assertTrue(!ok);
            assertEq(
                keccak256(reason), keccak256(abi.encodeWithSelector(EndpointRegistry.Unauthorized.selector))
            );
            assertEq(_snapshot(), beforeHash);
        }
    }

    function testMissingReadsAndMutationsRevert() public {
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.ResourceNotFound.selector, id));
        registry.getResource(id);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.ResourceNotFound.selector, id));
        registry.disable(id, 0);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.ResourceNotFound.selector, id));
        registry.updateConfiguration(id, 0, BOB, 1, CONFIG, true);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.ResourceNotFound.selector, id));
        registry.transferOwnership(id, 0, BOB);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.ResourceNotFound.selector, id));
        registry.acceptOwnership(id, 0);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.ResourceNotFound.selector, id));
        registry.cancelOwnershipTransfer(id, 0);
    }

    function testDisableRetainsConfigurationAndIdentifier() public {
        _register();
        vm.prank(ALICE);
        registry.disable(id, 1);
        EndpointRegistry.Resource memory r = registry.getResource(id);
        assertTrue(!r.enabled);
        assertEq(r.priceAtomic, 1_000_000);
        assertEq(r.configHash, CONFIG);
        assertEq(r.owner, ALICE);
        assertEq(r.version, 2);
        vm.expectRevert(EndpointRegistry.AlreadyDisabled.selector);
        vm.prank(ALICE);
        registry.disable(id, 2);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.AlreadyRegistered.selector, id));
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 1, CONFIG, true);
    }

    function testReenableRequiresExplicitOwnerUpdate() public {
        _register();
        vm.prank(ALICE);
        registry.disable(id, 1);
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(BOB);
        registry.updateConfiguration(id, 2, BOB, 1_000_000, CONFIG, true);
        vm.prank(ALICE);
        registry.updateConfiguration(id, 2, BOB, 1_000_000, CONFIG, true);
        assertTrue(registry.getResource(id).enabled);
        assertEq(registry.getResource(id).version, 3);
    }

    function testOwnershipRequiresAcceptanceAndPreservesPayout() public {
        _register();
        vm.prank(ALICE);
        registry.transferOwnership(id, 1, CAROL);
        assertEq(registry.getResource(id).owner, ALICE);
        assertEq(registry.getResource(id).pendingOwner, CAROL);
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(CAROL);
        registry.disable(id, 2);
        vm.prank(CAROL);
        registry.acceptOwnership(id, 2);
        EndpointRegistry.Resource memory r = registry.getResource(id);
        assertEq(r.owner, CAROL);
        assertEq(r.pendingOwner, address(0));
        assertEq(r.payout, BOB);
        assertEq(r.version, 3);
        assertTrue(r.enabled);
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(ALICE);
        registry.disable(id, 3);
        vm.prank(CAROL);
        registry.disable(id, 3);
        assertTrue(!registry.getResource(id).enabled);
        assertEq(registry.deriveResourceId(ALICE, UUID), id);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.AlreadyRegistered.selector, id));
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, 1, CONFIG, true);
    }

    function testNoNominationCannotAcceptEvenAsZeroCaller() public {
        _register();
        bytes32 beforeHash = _snapshot();
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(address(0));
        registry.acceptOwnership(id, 1);
        assertEq(_snapshot(), beforeHash);
    }

    function testInvalidTransferAndCancellation() public {
        _register();
        vm.expectRevert(EndpointRegistry.ZeroAddress.selector);
        vm.prank(ALICE);
        registry.transferOwnership(id, 1, address(0));
        vm.expectRevert(EndpointRegistry.InvalidNewOwner.selector);
        vm.prank(ALICE);
        registry.transferOwnership(id, 1, ALICE);
        vm.expectRevert(EndpointRegistry.NoPendingTransfer.selector);
        vm.prank(ALICE);
        registry.cancelOwnershipTransfer(id, 1);
        vm.prank(ALICE);
        registry.transferOwnership(id, 1, BOB);
        vm.expectRevert(EndpointRegistry.InvalidNewOwner.selector);
        vm.prank(ALICE);
        registry.transferOwnership(id, 2, BOB);
        vm.prank(ALICE);
        registry.cancelOwnershipTransfer(id, 2);
        assertEq(registry.getResource(id).pendingOwner, address(0));
        assertEq(registry.getResource(id).owner, ALICE);
        assertEq(registry.getResource(id).version, 3);
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(BOB);
        registry.acceptOwnership(id, 3);
    }

    function testReplacementAndStaleAcceptance() public {
        _register();
        vm.prank(ALICE);
        registry.transferOwnership(id, 1, BOB);
        vm.prank(ALICE);
        registry.transferOwnership(id, 2, CAROL);
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(BOB);
        registry.acceptOwnership(id, 3);
        vm.prank(ALICE);
        registry.updateConfiguration(id, 3, CAROL, 2, CONFIG, true);
        vm.expectRevert(
            abi.encodeWithSelector(EndpointRegistry.VersionMismatch.selector, uint64(3), uint64(4))
        );
        vm.prank(CAROL);
        registry.acceptOwnership(id, 3);
        vm.prank(CAROL);
        registry.acceptOwnership(id, 4);
        assertEq(registry.getResource(id).owner, CAROL);
        assertEq(registry.getResource(id).version, 5);
    }

    function testDisabledTransferDoesNotReenable() public {
        _register();
        vm.prank(ALICE);
        registry.disable(id, 1);
        vm.prank(ALICE);
        registry.transferOwnership(id, 2, CAROL);
        vm.prank(CAROL);
        registry.acceptOwnership(id, 3);
        assertTrue(!registry.getResource(id).enabled);
        assertEq(registry.getResource(id).payout, BOB);
    }

    function testRegistrationAndUpdateEvents() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit EndpointRegistry.ResourceRegistered(id, ALICE, UUID, BOB, 1_000_000, CONFIG, true, 1);
        _register();
        vm.expectEmit(true, true, false, true, address(registry));
        emit EndpointRegistry.ConfigurationUpdated(id, ALICE, CAROL, 7, CONFIG, false, 2);
        vm.prank(ALICE);
        registry.updateConfiguration(id, 1, CAROL, 7, CONFIG, false);
    }

    function testDisableAndOwnershipEvents() public {
        _register();
        vm.expectEmit(true, true, false, true, address(registry));
        emit EndpointRegistry.ResourceDisabled(id, ALICE, 2);
        vm.prank(ALICE);
        registry.disable(id, 1);
        vm.expectEmit(true, true, true, true, address(registry));
        emit EndpointRegistry.OwnershipTransferStarted(id, ALICE, BOB, 3);
        vm.prank(ALICE);
        registry.transferOwnership(id, 2, BOB);
        vm.expectEmit(true, true, true, true, address(registry));
        emit EndpointRegistry.OwnershipTransferCancelled(id, ALICE, BOB, 4);
        vm.prank(ALICE);
        registry.cancelOwnershipTransfer(id, 3);
        vm.prank(ALICE);
        registry.transferOwnership(id, 4, CAROL);
        vm.expectEmit(true, true, true, true, address(registry));
        emit EndpointRegistry.OwnershipTransferred(id, ALICE, CAROL, 6);
        vm.prank(CAROL);
        registry.acceptOwnership(id, 5);
    }

    function testRejectedMutationEmitsNoEvents() public {
        _register();
        vm.recordLogs();
        vm.prank(BOB);
        (bool ok,) = address(registry).call(abi.encodeCall(registry.disable, (id, 1)));
        assertTrue(!ok);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
    }

    function testConstructorRejectsWrongChainLocally() public {
        vm.chainId(0);
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.UnsupportedChain.selector, uint256(0)));
        new EndpointRegistry();
        vm.chainId(8453);
    }

    function testRejectsEtherAndUnknownCalls() public {
        _register();
        vm.deal(ALICE, 1 ether);
        bytes32 beforeHash = _snapshot();
        vm.prank(ALICE);
        (bool sent,) = address(registry).call{value: 1}("");
        assertTrue(!sent);
        vm.prank(ALICE);
        (bool payableMethod,) = address(registry).call{value: 1}(abi.encodeCall(registry.disable, (id, 1)));
        assertTrue(!payableMethod);
        (bool unknown,) = address(registry).call(hex"deadbeef");
        assertTrue(!unknown);
        assertEq(address(registry).balance, 0);
        assertEq(ALICE.balance, 1 ether);
        assertEq(_snapshot(), beforeHash);
    }

    function testReadIsStaticAndDoesNotMutate() public {
        _register();
        bytes32 beforeHash = _snapshot();
        (bool ok, bytes memory data) =
            address(registry).staticcall(abi.encodeCall(registry.getResource, (id)));
        assertTrue(ok);
        EndpointRegistry.Resource memory r = abi.decode(data, (EndpointRegistry.Resource));
        assertEq(r.owner, ALICE);
        assertEq(_snapshot(), beforeHash);
    }

    function testFuzzPriceRoundTrip(uint96 raw, bytes16 uuid) public {
        if (uuid == bytes16(0)) uuid = bytes16(uint128(1));
        uint96 price = (raw % 999_999_999_999) + 1;
        vm.prank(ALICE);
        bytes32 resourceId = registry.register(uuid, ALICE, BOB, price, CONFIG, true);
        assertEq(registry.getResource(resourceId).priceAtomic, price);
        vm.prank(ALICE);
        registry.updateConfiguration(resourceId, 1, BOB, price == 1 ? 2 : 1, CONFIG, true);
        assertEq(registry.getResource(resourceId).priceAtomic, price == 1 ? 2 : 1);
        assertEq(registry.getResource(resourceId).version, 2);
    }

    function testFuzzOutOfRangePriceRejected(uint96 raw) public {
        uint96 price =
            uint96(uint256(raw) % (uint256(type(uint96).max) - 999_999_999_999)) + 1_000_000_000_000;
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.InvalidPrice.selector, price));
        vm.prank(ALICE);
        registry.register(UUID, ALICE, BOB, price, CONFIG, true);
    }

    function testFuzzIdentifierEncodingAndUniqueness(bytes16 a, bytes16 b, address owner) public view {
        if (a == bytes16(0) || b == bytes16(0) || owner == address(0)) return;
        bytes32 first = registry.deriveResourceId(owner, a);
        assertEq(
            first, keccak256(abi.encode(keccak256("SignalArcGate.Resource.v1"), uint256(8453), owner, a))
        );
        if (a != b) assertTrue(first != registry.deriveResourceId(owner, b));
        if (owner != BOB) assertTrue(first != registry.deriveResourceId(BOB, a));
    }

    function testFuzzUnauthorizedUpdate(address attacker, uint96 price) public {
        if (attacker == ALICE || attacker == address(0)) return;
        _register();
        bytes32 beforeHash = _snapshot();
        vm.expectRevert(EndpointRegistry.Unauthorized.selector);
        vm.prank(attacker);
        registry.updateConfiguration(id, 1, attacker, price, CONFIG, false);
        assertEq(_snapshot(), beforeHash);
    }

    function testFuzzStaleVersion(uint64 version) public {
        if (version == 1) return;
        _register();
        vm.expectRevert(abi.encodeWithSelector(EndpointRegistry.VersionMismatch.selector, version, uint64(1)));
        vm.prank(ALICE);
        registry.disable(id, version);
        assertTrue(registry.getResource(id).enabled);
        assertEq(registry.getResource(id).version, 1);
    }
}

/// @dev Successful calls only. Setup snapshot gives update/disable original (not dirty) storage values.
contract EndpointRegistryGasTest is TestSupport {
    EndpointRegistry internal registry;
    bytes16 internal constant UUID = bytes16(uint128(1));
    bytes32 internal constant CONFIG = keccak256("gas measurement only");
    bytes32 internal id;

    function setUp() public {
        registry = new EndpointRegistry();
        id = registry.register(UUID, address(this), address(0xB0B), 1_000_000, CONFIG, true);
    }

    function testGasRegister() public {
        bytes32 second =
            registry.register(bytes16(uint128(2)), address(this), address(0xB0B), 1_000_000, CONFIG, true);
        assertEq(registry.getResource(second).version, 1);
    }

    function testGasUpdate() public {
        registry.updateConfiguration(id, 1, address(0xCA401), 2_000_000, keccak256("changed"), true);
        assertEq(registry.getResource(id).version, 2);
    }

    function testGasDisable() public {
        registry.disable(id, 1);
        assertTrue(!registry.getResource(id).enabled);
    }
}
