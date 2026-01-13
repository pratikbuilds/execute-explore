# Implementation Plan: Metaplex Core Execute CPI for SOL Transfer

## Objective

Implement a CPI call to Metaplex Core's `execute` instruction from an Anchor program to transfer SOL from a Core NFT's asset signer PDA to a destination address. This will help understand the complexity of making execute CPI calls.

## Background Context

**Current State:**

- Basic Anchor workspace at `/Users/pratik/development/projects/token_bundles_proj/bundles`
- Simple initialize instruction in `programs/token_bundles/src/lib.rs`
- TypeScript reference implementation at `/Users/pratik/development/projects/token_bundles_proj/token-bundles-test/index.ts`

**Reference Pattern from TypeScript:**

1. Create/fetch a Core NFT asset
2. Derive asset signer PDA using `findAssetSignerPda`
3. Fund the asset signer PDA with SOL
4. Create a `transferSol` instruction (source = asset signer PDA, destination = target address)
5. Wrap the transfer instruction inside `execute` call
6. The execute uses the asset to sign for the asset signer PDA via CPI

## Implementation Steps

### 1. Add Dependencies

**File:** `programs/token_bundles/Cargo.toml`

Add the following dependencies:

```toml
mpl-core = { version = "0.11", features = ["anchor"] }
solana-program = "1.18"
```

### 2. Create Execute Transfer Instruction

**File:** `programs/token_bundles/src/lib.rs`

Create a new instruction `execute_transfer_sol` that:

- Takes a Core NFT asset as input
- Accepts a destination address and amount
- Makes a CPI call to mpl-core's execute instruction
- The nested instruction transfers SOL from asset signer PDA to destination

**Key Components:**

- Use `ExecuteV1CpiBuilder` from `mpl_core::instructions`
- Derive the asset signer PDA (seeds: `["asset", asset_pubkey]` and mpl-core program as owner)
- Build nested transfer instruction using `solana_program::system_instruction::transfer`
- Pass all required accounts in correct order

**Account Structure (7 required accounts):**

```rust
#[derive(Accounts)]
pub struct ExecuteTransferSol<'info> {
    /// The Core NFT asset (writable)
    /// CHECK: Validated by mpl-core program
    #[account(mut)]
    pub asset: AccountInfo<'info>,

    /// The collection account (optional, writable)
    /// CHECK: Validated by mpl-core program
    #[account(mut)]
    pub collection: Option<AccountInfo<'info>>,

    /// The asset signer PDA (non-writable)
    /// CHECK: PDA derived by mpl-core with seeds ["asset", asset.key()]
    pub asset_signer: AccountInfo<'info>,

    /// The payer for transaction fees (writable, signer)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The asset owner/authority (optional signer)
    pub authority: Option<Signer<'info>>,

    /// Destination for SOL transfer (writable)
    /// CHECK: Can be any address
    #[account(mut)]
    pub destination: AccountInfo<'info>,

    /// System program
    pub system_program: Program<'info, System>,

    /// Metaplex Core program
    /// CHECK: Must be the mpl-core program ID
    pub mpl_core_program: AccountInfo<'info>,
}
```

**Instruction Logic:**

1. Verify asset signer PDA derivation matches expected PDA
2. Create system transfer instruction:
   ```rust
   let transfer_ix = solana_program::system_instruction::transfer(
       asset_signer.key,
       destination.key,
       amount
   );
   ```
3. Create ExecuteV1InstructionArgs with the transfer instruction data:
   ```rust
   let execute_args = ExecuteV1InstructionArgs {
       instruction_data: transfer_ix.data,
   };
   ```
4. Use ExecuteV1CpiBuilder to wrap and invoke:
   ```rust
   ExecuteV1CpiBuilder::new(&ctx.accounts.mpl_core_program)
       .asset(&ctx.accounts.asset)
       .collection(ctx.accounts.collection.as_ref())
       .asset_signer(&ctx.accounts.asset_signer)
       .payer(&ctx.accounts.payer)
       .authority(ctx.accounts.authority.as_ref())
       .system_program(&ctx.accounts.system_program)
       // Add remaining accounts for the nested transfer
       .add_remaining_account(&ctx.accounts.asset_signer, false, true)
       .add_remaining_account(&ctx.accounts.destination, false, true)
       .invoke()
   ```

### 3. Add Helper Functions (Optional)

**File:** `programs/token_bundles/src/lib.rs` or new `src/utils.rs`

Create helper functions for:

- Deriving asset signer PDA
- Validating asset ownership
- Building nested transfer instructions

### 4. Create Anchor Tests

**File:** `tests/token_bundles.ts`

Implement tests that:

1. Set up test environment with devnet/localnet connection
2. Create a Core NFT asset
3. Fund the asset signer PDA with SOL (must have balance to transfer)
4. Call the `execute_transfer_sol` instruction
5. Verify SOL was transferred from asset signer PDA to destination
6. Check balance changes

**Test Flow:**

```typescript
// 1. Create Core asset
const asset = await createCoreAsset(...)

// 2. Derive asset signer PDA
const [assetSigner] = findAssetSignerPda(asset)

// 3. Fund asset signer PDA
await transferSol(assetSigner, 1 SOL)

// 4. Call program instruction
await program.methods
  .executeTransferSol(amount)
  .accounts({
    asset,
    authority: owner,
    destination: recipientPubkey,
    assetSigner,
    mplCoreProgram: MPL_CORE_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc()

// 5. Verify balances
```

### 5. Create LiteSVM Tests

**File:** New `tests/litesvm_test.rs` or similar

Set up fast unit tests using litesvm:

1. Create minimal test harness
2. Deploy mpl-core program (or use mocked version)
3. Run quick iterations of the execute CPI
4. Useful for rapid development without full localnet deployment

**Benefits:**

- Much faster test execution
- No need for validator
- Quick iteration during development

### 6. Update Package Configuration

**File:** `package.json`

Add/update test scripts:

```json
{
  "scripts": {
    "test": "anchor test",
    "test:litesvm": "cargo test-sbf"
  }
}
```

## Critical Files to Create/Modify

1. **programs/token_bundles/Cargo.toml** - Add mpl-core dependency
2. **programs/token_bundles/src/lib.rs** - Implement execute_transfer_sol instruction
3. **tests/token_bundles.ts** - Create comprehensive Anchor tests
4. **tests/litesvm_test.rs** - Create fast litesvm unit tests
5. **package.json** - Add test scripts (if needed)

## Technical Considerations

### Asset Signer PDA Derivation

The asset signer PDA must be derived correctly:

- Seeds: `["asset", asset_pubkey.as_ref()]`
- Program: MPL_CORE_PROGRAM_ID
- Use mpl-core's helper function or manual derivation with `Pubkey::find_program_address`

### Account Constraints

- Asset must be owned by MPL Core program
- Authority must be the asset owner
- Asset signer PDA must have sufficient balance for the transfer
- All accounts must be in the correct order for ExecuteV1CpiBuilder

### Remaining Accounts Pattern

The nested instruction (system transfer) requires its own accounts:

- The asset signer PDA (as source, must be writable)
- The destination address (as target, must be writable)
- These must be passed as "remaining accounts" to ExecuteV1CpiBuilder
- Use `.add_remaining_account()` for each account the nested instruction needs

### CPI Security

- Verify the mpl-core program ID matches MPL_CORE_PROGRAM_ID
- Validate asset ownership before CPI
- Ensure asset signer PDA is correctly derived
- Check that the asset signer has sufficient balance

### Instruction Data Serialization

- The ExecuteV1InstructionArgs takes raw instruction bytes
- System transfer instruction provides `.data` field directly
- No manual Borsh serialization needed
- The mpl-core program deserializes and executes the instruction

## Verification Strategy

### Unit Tests (LiteSVM)

1. Test basic CPI call structure
2. Test PDA derivation
3. Test with various amounts
4. Test error conditions (insufficient balance, wrong authority, etc.)

### Integration Tests (Anchor)

1. Full end-to-end flow on localnet
2. Create real Core NFT
3. Fund asset signer PDA
4. Execute transfer via CPI
5. Verify balance changes
6. Test with multiple assets (optional future enhancement)

### Manual Testing

1. Deploy to devnet
2. Test with real Core NFT from the existing TS test
3. Verify SOL transfers correctly
4. Monitor transaction logs for CPI success

## Expected Outcomes

1. **Working CPI Implementation** - Successfully call mpl-core's execute from Anchor program
2. **Understanding Complexity** - Gain insight into execute CPI difficulty level
3. **Test Coverage** - Both fast (litesvm) and comprehensive (anchor) tests
4. **Reusable Pattern** - Template for future execute CPIs (token transfers, other operations)

## Complexity Assessment

### Expected Difficulty: **Medium**

**Why it's not trivial:**

1. **Account Management** - Need to pass 7+ accounts in correct order
2. **Remaining Accounts** - Must understand the remaining accounts pattern for nested instructions
3. **PDA Derivation** - Asset signer PDA must be derived correctly
4. **Instruction Wrapping** - Need to wrap a system instruction inside execute instruction
5. **Two-level CPI** - Your program → mpl-core → system program (nested CPI)

**Why it's not too complex:**

1. **Clear Builder Pattern** - ExecuteV1CpiBuilder provides good abstraction
2. **No Manual Serialization** - Instruction data is handled automatically
3. **Standard System Transfer** - The nested instruction is well-documented
4. **Good Documentation** - Metaplex provides comprehensive docs and examples
5. **Type Safety** - Rust's type system catches most mistakes at compile time

**Key Insight:**
The main challenge is understanding the "remaining accounts" pattern. The execute instruction needs to know which accounts the nested instruction will use, so they must be passed through as remaining accounts. Once you understand this pattern, it's straightforward.

### Learning Value

This implementation will teach:

- How to make nested CPI calls (CPI within CPI)
- Account management for complex instructions
- Working with Metaplex Core SDK in Rust
- PDA derivation patterns
- Remaining accounts pattern in Solana programs

## Next Steps After Implementation

1. Test with different amounts
2. Add error handling for edge cases (insufficient balance, wrong authority, etc.)
3. Consider extending to SPL token transfers (similar pattern, different instruction)
4. Explore batch/bundle operations with multiple assets
5. Document findings and create a reusable template
6. Compare complexity with other Metaplex CPI patterns
