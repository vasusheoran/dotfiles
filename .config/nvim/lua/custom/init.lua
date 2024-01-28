-- vim.api.nvim_create_autocmd("BufWinEnter", {
--         pattern = "*.templ",
--         command = "set filetype=templ",
-- })

-- Add .templ extension to filetype
vim.filetype.add({ extension = { templ = "templ" } })

vim.wo.relativenumber = true
