-- AddForeignKey
ALTER TABLE "ProfileFieldDeferral" ADD CONSTRAINT "ProfileFieldDeferral_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
