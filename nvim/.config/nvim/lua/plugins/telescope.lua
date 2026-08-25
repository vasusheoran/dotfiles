return {
    {
        "nvim-telescope/telescope-ui-select.nvim",
    },
    {
        "nvim-telescope/telescope.nvim",
        tag = "0.1.5",
        dependencies = { "nvim-lua/plenary.nvim" },
        config = function()
            require("telescope").setup({
                extensions = {
                    ["ui-select"] = {
                        require("telescope.themes").get_dropdown({}),
                    },
                },
            })
            local builtin = require("telescope.builtin")
            vim.keymap.set("n", "<C-p>", builtin.find_files, {})
            vim.keymap.set("n", "<leader>fg", builtin.live_grep, {})
            vim.keymap.set("n", "<leader><leader>", builtin.oldfiles, {})



            -- Enable telescope fzf native, if installed
            pcall(require('telescope').load_extension, 'fzf')
            pcall(require('telescope').load_extension, 'harpoon')
            -- See `:help telescope.builtin`
            vim.keymap.set('n', '<leader>fo', require('telescope.builtin').oldfiles,
                { desc = '[f]ind recently [o] opened files' })
            vim.keymap.set('n', '<leader>fb', require('telescope.builtin').buffers,
                { desc = '[f]ind existing [b] buffers' })
            vim.keymap.set('n', '<leader>f/', function()
                -- You can pass additional configuration to telescope to change theme, layout, etc.
                require('telescope.builtin').current_buffer_fuzzy_find(require('telescope.themes').get_dropdown {
                    winblend = 10,
                    previewer = false,
                })
            end, { desc = '[f]uzzily search in [/] current buffer' })

            local function telescope_live_grep_open_files()
                require('telescope.builtin').live_grep {
                    grep_open_files = true,
                    prompt_title = 'Live Grep in Open Files',
                }
            end
            vim.keymap.set('n', '<leader>fs', telescope_live_grep_open_files, { desc = '[f]ind [/] in Open Files' })
            vim.keymap.set('n', '<leader>ft', require('telescope.builtin').builtin,
                { desc = '[F]ind select [T]elescope' })
            vim.keymap.set('n', '<leader>gf', require('telescope.builtin').git_files, { desc = 'Search [G]it [F]iles' })
            vim.keymap.set('n', '<leader>ff', require('telescope.builtin').find_files, { desc = '[F]ind [F]iles' })
            vim.keymap.set('n', '<leader>fh', require('telescope.builtin').help_tags, { desc = '[F]ind [H]elp' })
            vim.keymap.set('n', '<leader>fw', require('telescope.builtin').grep_string,
                { desc = '[F]ind current [W]ord' })
            vim.keymap.set('n', '<leader>fg', require('telescope.builtin').live_grep, { desc = '[F]ind by [G]rep' })
            vim.keymap.set('n', '<leader>gg', ':LiveGrepGitRoot<cr>', { desc = 'Find by [G]rep on [G]it Root' })
            vim.keymap.set('n', '<leader>fd', require('telescope.builtin').diagnostics, { desc = '[F]ind [D]iagnostics' })
            vim.keymap.set('n', '<leader>fr', require('telescope.builtin').resume, { desc = '[F]ind [R]esume' })

            require("telescope").load_extension("ui-select")
        end,
    },
}
