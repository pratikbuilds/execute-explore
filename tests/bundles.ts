import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Bundles } from "../target/types/bundles";
import {
  createV1,
  mplCore,
  findAssetSignerPda,
} from "@metaplex-foundation/mpl-core";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  publicKey,
} from "@metaplex-foundation/umi";
import { SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("bundles", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.bundles as Program<Bundles>;
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });

  describe("execute_transfer_sol", () => {
    it("should transfer SOL from asset signer PDA to destination", async () => {
      // 1. Setup Umi instance for Metaplex Core operations
      const umi = createUmi(connection.rpcEndpoint);
      const umiKeypair = umi.eddsa.createKeypairFromSecretKey(
        provider.wallet.payer.secretKey
      );
      umi.use(keypairIdentity(umiKeypair)).use(mplCore());

      // 2. Create a Core NFT asset
      console.log("Creating Core NFT asset...");
      const asset = generateSigner(umi);
      const owner = generateSigner(umi);

      await createV1(umi, {
        asset,
        name: "Test Asset",
        uri: "https://example.com/asset",
        owner: owner.publicKey,
      }).sendAndConfirm(umi);

      console.log("Asset created:", asset.publicKey.toString());

      // Fund the owner account so it can sign transactions
      const ownerKeypair = anchor.web3.Keypair.fromSecretKey(owner.secretKey);
      const fundOwnerTx = await connection.sendTransaction(
        new anchor.web3.Transaction().add(
          SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: ownerKeypair.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        ),
        [provider.wallet.payer]
      );
      await connection.confirmTransaction(fundOwnerTx);
      console.log("Owner funded with 0.1 SOL");

      // 3. Derive asset signer PDA using mpl-core helper
      const [assetSignerPda] = findAssetSignerPda(umi, {
        asset: asset.publicKey,
      });
      const assetSigner = new anchor.web3.PublicKey(assetSignerPda.toString());
      const assetPublicKey = new anchor.web3.PublicKey(
        asset.publicKey.toString()
      );
      const mplCoreProgram = new anchor.web3.PublicKey(
        "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
      );

      console.log("Asset signer PDA:", assetSigner.toString());

      // 4. Fund the asset signer PDA
      const fundAmount = 2 * LAMPORTS_PER_SOL;
      console.log("Funding asset signer PDA with 2 SOL...");

      const fundTx = await connection.sendTransaction(
        new anchor.web3.Transaction().add(
          SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: assetSigner,
            lamports: fundAmount,
          })
        ),
        [provider.wallet.payer]
      );
      await connection.confirmTransaction(fundTx);

      const assetSignerBalanceBefore = await connection.getBalance(assetSigner);
      console.log(
        "Asset signer balance before transfer:",
        assetSignerBalanceBefore / LAMPORTS_PER_SOL,
        "SOL"
      );

      // 5. Create destination account
      const destination = anchor.web3.Keypair.generate();
      const destinationBalanceBefore = await connection.getBalance(
        destination.publicKey
      );

      // 6. Execute transfer via our program
      const transferAmount = 1 * LAMPORTS_PER_SOL; // Transfer 1 SOL
      console.log("Executing transfer of 1 SOL...");

      const tx = await program.methods
        .executeTransferSol(new BN(transferAmount))
        .accounts({
          asset: assetPublicKey,
          collection: null,
          payer: provider.wallet.publicKey,
          authority: ownerKeypair.publicKey,
          assetSigner: assetSigner,
          destination: destination.publicKey,
          mplCoreProgram: mplCoreProgram,
        })
        .signers([ownerKeypair])
        .rpc();

      console.log("Transfer transaction signature:", tx);

      // 7. Verify balances after transfer
      const assetSignerBalanceAfter = await connection.getBalance(assetSigner);
      const destinationBalanceAfter = await connection.getBalance(
        destination.publicKey
      );

      console.log(
        "Asset signer balance after transfer:",
        assetSignerBalanceAfter / LAMPORTS_PER_SOL,
        "SOL"
      );
      console.log(
        "Destination balance after transfer:",
        destinationBalanceAfter / LAMPORTS_PER_SOL,
        "SOL"
      );

      // Assertions
      expect(assetSignerBalanceAfter).to.equal(
        assetSignerBalanceBefore - transferAmount
      );
      expect(destinationBalanceAfter).to.equal(
        destinationBalanceBefore + transferAmount
      );

      console.log("✓ Transfer successful!");
    });

    xit("should fail with invalid asset signer PDA", async () => {
      const umi = createUmi(connection.rpcEndpoint);
      const umiKeypair = umi.eddsa.createKeypairFromSecretKey(
        provider.wallet.payer.secretKey
      );
      umi.use(keypairIdentity(umiKeypair)).use(mplCore());

      // Create asset
      const asset = generateSigner(umi);
      const owner = generateSigner(umi);

      await createV1(umi, {
        asset,
        name: "Test Asset 2",
        uri: "https://example.com/asset2",
        owner: owner.publicKey,
      }).sendAndConfirm(umi);

      // Fund the owner account so it can sign transactions
      const ownerKeypair = anchor.web3.Keypair.fromSecretKey(owner.secretKey);
      const fundOwnerTx = await connection.sendTransaction(
        new anchor.web3.Transaction().add(
          SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: ownerKeypair.publicKey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        ),
        [provider.wallet.payer]
      );
      await connection.confirmTransaction(fundOwnerTx);

      const assetPublicKey = new anchor.web3.PublicKey(
        asset.publicKey.toString()
      );
      const mplCoreProgram = new anchor.web3.PublicKey(
        "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
      );

      // Use wrong asset signer PDA (random account)
      const wrongAssetSigner = anchor.web3.Keypair.generate();

      const destination = anchor.web3.Keypair.generate();

      try {
        await program.methods
          .executeTransferSol(new BN(1000))
          .accounts({
            asset: assetPublicKey,
            collection: null,
            payer: provider.wallet.publicKey,
            authority: ownerKeypair.publicKey,
            assetSigner: wrongAssetSigner.publicKey,
            destination: destination.publicKey,
            mplCoreProgram: mplCoreProgram,
          })
          .signers([ownerKeypair])
          .rpc();

        // Should not reach here
        expect.fail("Expected transaction to fail with invalid asset signer");
      } catch (err) {
        expect(err.message).to.include("InvalidAssetSigner");
        console.log("✓ Correctly rejected invalid asset signer PDA");
      }
    });
  });
});
