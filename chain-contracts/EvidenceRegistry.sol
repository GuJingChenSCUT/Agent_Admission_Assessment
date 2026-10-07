// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';

/// @notice Custom append-only observation registry. Not ERC-8004. Not audited.
/// @dev EIP-712 binds the deployed address and chain; production target is BOT 677.
contract EvidenceRegistry is EIP712 {
    struct EvidenceClaim {
        bytes32 reportHash; bytes32 taskSpecHash; bytes32 policyHash; bytes32 subjectHash;
        uint256 sourceChainId; uint8 resultCode; bytes32 evidenceURIHash;
        uint64 observedAt; uint64 expiresAt; uint256 nonce;
    }
    bytes32 public constant CLAIM_TYPEHASH = keccak256('EvidenceClaim(bytes32 reportHash,bytes32 taskSpecHash,bytes32 policyHash,bytes32 subjectHash,uint256 sourceChainId,uint8 resultCode,bytes32 evidenceURIHash,uint64 observedAt,uint64 expiresAt,uint256 nonce)');
    address public immutable trustedValidator;
    mapping(bytes32 => bool) public isRegistered;
    mapping(bytes32 => bool) public isRevoked;
    mapping(uint256 => bool) public usedNonce;
    mapping(bytes32 => EvidenceClaim) public records;
    event EvidenceSubmitted(bytes32 indexed reportHash,address indexed validator,uint256 indexed sourceChainId,bytes32 taskSpecHash,bytes32 policyHash,bytes32 subjectHash,uint8 resultCode,string evidenceURI,uint64 observedAt,uint64 expiresAt,uint256 nonce);
    event EvidenceRevoked(bytes32 indexed reportHash,address indexed validator,bytes32 reasonHash);
    error Unauthorized(); error InvalidClaim(); error Replay(); error AlreadyRegistered();
    constructor(address validator) EIP712('AgentAdmissionEvidence','1') {
        if (validator == address(0)) revert InvalidClaim(); trustedValidator = validator;
    }
    function submitEvidence(EvidenceClaim calldata claim,string calldata evidenceURI,bytes calldata validatorSignature) external {
        if (claim.sourceChainId != 1 || claim.resultCode > 3 || claim.reportHash == bytes32(0)
            || claim.taskSpecHash == bytes32(0) || claim.policyHash == bytes32(0) || claim.subjectHash == bytes32(0)
            || claim.observedAt > claim.expiresAt || claim.expiresAt <= block.timestamp
            || claim.observedAt > block.timestamp + 5 minutes || bytes(evidenceURI).length == 0
            || bytes(evidenceURI).length > 1024 || keccak256(bytes(evidenceURI)) != claim.evidenceURIHash) revert InvalidClaim();
        if (usedNonce[claim.nonce]) revert Replay();
        if (isRegistered[claim.reportHash]) revert AlreadyRegistered();
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, claim));
        if (ECDSA.recover(_hashTypedDataV4(structHash), validatorSignature) != trustedValidator) revert Unauthorized();
        usedNonce[claim.nonce] = true; isRegistered[claim.reportHash] = true; records[claim.reportHash] = claim;
        emit EvidenceSubmitted(claim.reportHash,trustedValidator,claim.sourceChainId,claim.taskSpecHash,claim.policyHash,claim.subjectHash,claim.resultCode,evidenceURI,claim.observedAt,claim.expiresAt,claim.nonce);
    }
    function revokeEvidence(bytes32 reportHash,bytes32 reasonHash) external {
        if (msg.sender != trustedValidator) revert Unauthorized();
        if (!isRegistered[reportHash] || isRevoked[reportHash] || reasonHash == bytes32(0)) revert InvalidClaim();
        isRevoked[reportHash] = true; emit EvidenceRevoked(reportHash,msg.sender,reasonHash);
    }
}
