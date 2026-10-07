// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Append-only evidence anchor for Agent admission observations.
/// @dev Custom contract draft. It is not ERC-8004, is not audited and has not been deployed.
contract EvidenceRegistry {
    struct EvidenceClaim { bytes32 reportHash; bytes32 taskSpecHash; bytes32 policyHash; bytes32 subjectHash; uint256 sourceChainId; uint8 resultCode; bytes32 evidenceURIHash; uint64 observedAt; uint64 expiresAt; uint256 nonce; }
    address public immutable trustedValidator;
    mapping(bytes32 => bool) public isRegistered;
    mapping(bytes32 => bool) public isRevoked;
    mapping(uint256 => bool) public usedNonce;
    event EvidenceSubmitted(bytes32 indexed reportHash, address indexed validator, uint256 indexed sourceChainId, bytes32 taskSpecHash, bytes32 policyHash, bytes32 subjectHash, uint8 resultCode, string evidenceURI, uint64 observedAt, uint64 expiresAt, uint256 nonce);
    event EvidenceRevoked(bytes32 indexed reportHash, address indexed validator, bytes32 reasonHash);
    error Unauthorized(); error InvalidClaim(); error Replay(); error AlreadyRegistered();
    constructor(address validator) { if (validator == address(0)) revert InvalidClaim(); trustedValidator = validator; }
    function submitEvidence(EvidenceClaim calldata claim, string calldata evidenceURI, bytes calldata) external {
        if (msg.sender != trustedValidator) revert Unauthorized();
        if (claim.sourceChainId != 1 || claim.resultCode > 3 || claim.reportHash == bytes32(0) || claim.observedAt > claim.expiresAt || keccak256(bytes(evidenceURI)) != claim.evidenceURIHash) revert InvalidClaim();
        if (usedNonce[claim.nonce]) revert Replay(); if (isRegistered[claim.reportHash]) revert AlreadyRegistered();
        usedNonce[claim.nonce] = true; isRegistered[claim.reportHash] = true;
        emit EvidenceSubmitted(claim.reportHash, msg.sender, claim.sourceChainId, claim.taskSpecHash, claim.policyHash, claim.subjectHash, claim.resultCode, evidenceURI, claim.observedAt, claim.expiresAt, claim.nonce);
    }
    function revokeEvidence(bytes32 reportHash, bytes32 reasonHash) external { if (msg.sender != trustedValidator) revert Unauthorized(); if (!isRegistered[reportHash] || isRevoked[reportHash]) revert InvalidClaim(); isRevoked[reportHash] = true; emit EvidenceRevoked(reportHash, msg.sender, reasonHash); }
}
