use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use mpl_core::instructions::ExecuteV1CpiBuilder;

declare_id!("3UMi7JMrQt6Dp1AqpuZE6ELAAZx2CF8WoPrF4RpxUHGx");

#[program]
pub mod bundles {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }

    pub fn execute_transfer_sol(ctx: Context<ExecuteTransferSol>, amount: u64) -> Result<()> {
        msg!("Executing SOL transfer of {} lamports", amount);

        // Note: We're not deriving the PDA ourselves - we trust the client passed the correct one
        // The mpl-core program will validate it during the execute CPI
        msg!("Asset: {}", ctx.accounts.asset.key);
        msg!("Asset signer PDA: {}", ctx.accounts.asset_signer.key);

        // Create the system transfer instruction
        let transfer_ix = system_instruction::transfer(
            ctx.accounts.asset_signer.key,
            ctx.accounts.destination.key,
            amount,
        );

        msg!(
            "Transfer instruction data length: {}",
            transfer_ix.data.len()
        );

        // Build and invoke the execute CPI call
        ExecuteV1CpiBuilder::new(&ctx.accounts.mpl_core_program)
            .asset(&ctx.accounts.asset)
            .collection(ctx.accounts.collection.as_ref())
            .asset_signer(&ctx.accounts.asset_signer)
            .payer(&ctx.accounts.payer)
            .authority(ctx.accounts.authority.as_ref().map(|s| s.as_ref()))
            .system_program(&ctx.accounts.system_program)
            .program_id(&ctx.accounts.system_program.to_account_info()) // The program_id of the nested instruction (System Program)
            .instruction_data(transfer_ix.data)
            .add_remaining_account(&ctx.accounts.asset_signer, false, true) // Not a signer - mpl-core will sign via CPI
            .add_remaining_account(&ctx.accounts.destination, false, true)
            .invoke()?;

        msg!("SOL transfer executed successfully");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

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

    /// The payer for transaction fees (writable, signer)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The asset owner/authority (optional signer)
    pub authority: Option<Signer<'info>>,

    /// The asset signer PDA (will be used as source in transfer)
    /// CHECK: PDA derived by mpl-core with seeds ["mpl-core-execute", asset.key()]
    /// Must be writable since it's the source of the transfer
    #[account(mut)]
    pub asset_signer: AccountInfo<'info>,

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
